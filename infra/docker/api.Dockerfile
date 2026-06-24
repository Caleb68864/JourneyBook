# Journey Book API — ASP.NET Core (.NET 10).
# Build context is the repository root.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Restore against the project file first for better layer caching.
COPY apps/api/JourneyBook.Api.csproj apps/api/
RUN dotnet restore apps/api/JourneyBook.Api.csproj

# Copy the rest and publish.
COPY apps/api/ apps/api/
RUN dotnet publish apps/api/JourneyBook.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "JourneyBook.Api.dll"]
