# Journey Book API — ASP.NET Core (.NET 10).
# Build context is the repository root.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore against project files first for better layer caching. The Api references
# the dotnet/ class libraries (Application -> Domain, Infrastructure ->
# Application/Domain), so their .csproj files must be present for restore to
# resolve the ProjectReferences. (Tests is not referenced by the Api and is omitted.)
COPY apps/api/JourneyBook.Api.csproj apps/api/
COPY dotnet/JourneyBook.Domain/JourneyBook.Domain.csproj dotnet/JourneyBook.Domain/
COPY dotnet/JourneyBook.Application/JourneyBook.Application.csproj dotnet/JourneyBook.Application/
COPY dotnet/JourneyBook.Infrastructure/JourneyBook.Infrastructure.csproj dotnet/JourneyBook.Infrastructure/
RUN dotnet restore apps/api/JourneyBook.Api.csproj

# Copy sources and publish.
COPY apps/api/ apps/api/
COPY dotnet/JourneyBook.Domain/ dotnet/JourneyBook.Domain/
COPY dotnet/JourneyBook.Application/ dotnet/JourneyBook.Application/
COPY dotnet/JourneyBook.Infrastructure/ dotnet/JourneyBook.Infrastructure/
RUN dotnet publish apps/api/JourneyBook.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "JourneyBook.Api.dll"]
