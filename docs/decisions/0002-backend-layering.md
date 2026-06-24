# ADR 0002 — Backend layering (Clean Architecture)

- Status: accepted
- Date: 2026-06-24
- Supersedes the "single api project for MVP" note in ADR 0001.

## Context

The Stage 0 skeleton shipped the API as one `apps/api` project. Before adding
entities, services, and persistence (Stage 2), the backend needed structural
seams so domain logic, use-cases, and EF Core/PostGIS concerns don't pile into
the web host.

## Decision

Adopt Clean Architecture with four C# projects under `dotnet/` plus the host:

```
apps/api/                     JourneyBook.Api            ASP.NET Core host
dotnet/JourneyBook.Domain         entities, value objects (Common/EntityBase)
dotnet/JourneyBook.Application    use-cases/services seam, AddApplication()
dotnet/JourneyBook.Infrastructure EF Core/Npgsql/PostGIS, AddInfrastructure()
dotnet/JourneyBook.Tests          xUnit
```

Dependency direction (compile-time enforced by project references):

- `Api` → `Application`, `Infrastructure`
- `Application` → `Domain`
- `Infrastructure` → `Application`, `Domain`
- `Tests` → `Domain`, `Application`, `Infrastructure`

### Conventions
- **DbContext** lives in `Infrastructure/Persistence/JourneyBookDbContext.cs`.
  It enables the `postgis` extension and calls
  `ApplyConfigurationsFromAssembly`, so entity maps are auto-discovered.
- **Composition roots**: each layer exposes a `DependencyInjection` extension
  (`AddApplication()`, `AddInfrastructure(IConfiguration)`); `Program.cs` calls
  `AddApplication().AddInfrastructure(builder.Configuration)`.
- **EF packages**: Npgsql provider + NetTopologySuite live in Infrastructure.
  `Microsoft.EntityFrameworkCore.Design` stays in `apps/api` (the startup
  project) so `dotnet ef` tooling works.
- **Migrations**:
  `dotnet ef migrations add <Name> -p dotnet/JourneyBook.Infrastructure -s apps/api`.

## Consequences

- Stage 2A can add entities to Domain and `IEntityTypeConfiguration<T>` maps to
  Infrastructure without touching the host.
- The host has no direct EF/Npgsql dependency — only the Infrastructure seam.
- A DI composition smoke test in `JourneyBook.Tests` guards the wiring.
- Slightly more projects to manage; acceptable for the product's expected scope.
