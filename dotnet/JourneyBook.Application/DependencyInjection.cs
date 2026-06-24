using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Application;

/// <summary>
/// Composition root for the Application layer (use-cases / services).
/// Stage 0 bones: no services registered yet — interfaces live under
/// <c>Abstractions/</c> and implementations get wired here as they land.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        // services.AddScoped<IProjectService, ProjectService>();  // Stage 2+
        return services;
    }
}
