using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class Stage2Persistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LocationNumber",
                table: "ImportantLocations",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ExpiresAt",
                table: "GeneratedPdfs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.InsertData(
                table: "TileSources",
                columns: new[] { "Id", "Attribution", "Key", "MaxZoom", "Provider", "SourceDate", "SourceUrl", "Version", "Cache_MaxAgeSeconds", "Cache_OfflineAllowed" },
                values: new object[] { new Guid("11111111-1111-1111-1111-111111111111"), "USGS The National Map", "usgs-topo", 16, "USGS", null, "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", null, 86400, false });

            migrationBuilder.CreateIndex(
                name: "IX_ImportantLocations_ProjectId_LocationNumber",
                table: "ImportantLocations",
                columns: new[] { "ProjectId", "LocationNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ImportantLocations_ProjectId_LocationNumber",
                table: "ImportantLocations");

            migrationBuilder.DeleteData(
                table: "TileSources",
                keyColumn: "Id",
                keyValue: new Guid("11111111-1111-1111-1111-111111111111"));

            migrationBuilder.DropColumn(
                name: "LocationNumber",
                table: "ImportantLocations");

            migrationBuilder.DropColumn(
                name: "ExpiresAt",
                table: "GeneratedPdfs");
        }
    }
}
