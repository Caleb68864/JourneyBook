using JourneyBook.Application;
using JourneyBook.Infrastructure;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace JourneyBook.Tests;

public class DependencyInjectionTests
{
    [Fact]
    public void Composition_root_registers_the_dbcontext()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] =
                    "Host=localhost;Port=5433;Database=journeybook;Username=journeybook;Password=journeybook",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddApplication().AddInfrastructure(configuration);

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        // Resolving (not connecting) proves the layered wiring is intact.
        var context = scope.ServiceProvider.GetService<JourneyBookDbContext>();
        Assert.NotNull(context);
    }
}
