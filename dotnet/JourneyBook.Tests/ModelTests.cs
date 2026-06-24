using JourneyBook.Domain.Entities;
using JourneyBook.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace JourneyBook.Tests;

public class ModelTests
{
    private static JourneyBookDbContext BuildContext()
    {
        // Offline: building/inspecting the EF model does not open a connection.
        var options = new DbContextOptionsBuilder<JourneyBookDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=journeybook;Username=journeybook;Password=journeybook",
                npgsql => npgsql.UseNetTopologySuite())
            .Options;
        return new JourneyBookDbContext(options);
    }

    [Theory]
    [InlineData(typeof(Project))]
    [InlineData(typeof(AtlasExtent))]
    [InlineData(typeof(AtlasPageGrid))]
    [InlineData(typeof(AtlasPage))]
    [InlineData(typeof(ImportantLocation))]
    [InlineData(typeof(TileSource))]
    [InlineData(typeof(GeneratedPdf))]
    [InlineData(typeof(ScalePreset))]
    public void Entity_is_mapped(Type entityType)
    {
        using var context = BuildContext();
        Assert.NotNull(context.Model.FindEntityType(entityType));
    }

    [Fact]
    public void Geometry_columns_use_srid_4326()
    {
        using var context = BuildContext();

        var bounds = context.Model.FindEntityType(typeof(AtlasExtent))!
            .FindProperty(nameof(AtlasExtent.Bounds))!;
        var point = context.Model.FindEntityType(typeof(ImportantLocation))!
            .FindProperty(nameof(ImportantLocation.Location))!;

        Assert.Contains("4326", bounds.GetColumnType());
        Assert.Contains("4326", point.GetColumnType());
    }
}
