using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "Projects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Projects", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScalePresets",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Label = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Ratio = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScalePresets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TileSources",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Provider = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    SourceUrl = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    SourceDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Attribution = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    MaxZoom = table.Column<int>(type: "integer", nullable: false),
                    Cache_MaxAgeSeconds = table.Column<int>(type: "integer", nullable: false),
                    Cache_OfflineAllowed = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TileSources", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "AtlasExtents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Bounds = table.Column<Polygon>(type: "geometry(Polygon, 4326)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AtlasExtents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AtlasExtents_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GeneratedPdfs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FilePath = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SourceMetadataSnapshot = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GeneratedPdfs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GeneratedPdfs_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ImportantLocations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Location = table.Column<Point>(type: "geometry(Point, 4326)", nullable: false),
                    Category = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    SourceConfidence = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    GeocodedFrom = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    GeocodeProvider = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportantLocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportantLocations_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AtlasPageGrids",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    ScalePresetId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Orientation = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Rows = table.Column<int>(type: "integer", nullable: false),
                    Columns = table.Column<int>(type: "integer", nullable: false),
                    Overlap = table.Column<double>(type: "double precision", nullable: false),
                    Margins_Top = table.Column<double>(type: "double precision", nullable: false),
                    Margins_Right = table.Column<double>(type: "double precision", nullable: false),
                    Margins_Bottom = table.Column<double>(type: "double precision", nullable: false),
                    Margins_Left = table.Column<double>(type: "double precision", nullable: false),
                    Margins_Gutter = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AtlasPageGrids", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AtlasPageGrids_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AtlasPageGrids_ScalePresets_ScalePresetId",
                        column: x => x.ScalePresetId,
                        principalTable: "ScalePresets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AtlasPages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PageGridId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Row = table.Column<int>(type: "integer", nullable: false),
                    Column = table.Column<int>(type: "integer", nullable: false),
                    NeighborNorth = table.Column<string>(type: "text", nullable: true),
                    NeighborSouth = table.Column<string>(type: "text", nullable: true),
                    NeighborEast = table.Column<string>(type: "text", nullable: true),
                    NeighborWest = table.Column<string>(type: "text", nullable: true),
                    Bounds = table.Column<Polygon>(type: "geometry(Polygon, 4326)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AtlasPages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AtlasPages_AtlasPageGrids_PageGridId",
                        column: x => x.PageGridId,
                        principalTable: "AtlasPageGrids",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "ScalePresets",
                columns: new[] { "Id", "Label", "Ratio" },
                values: new object[,]
                {
                    { "1-100000", "1:100,000", 100000 },
                    { "1-25000", "1:25,000", 25000 },
                    { "1-50000", "1:50,000", 50000 },
                    { "usgs-15-min", "15-minute (1:62,500)", 62500 },
                    { "usgs-7-5-min", "7.5-minute (1:24,000)", 24000 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_AtlasExtents_ProjectId",
                table: "AtlasExtents",
                column: "ProjectId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AtlasPageGrids_ProjectId",
                table: "AtlasPageGrids",
                column: "ProjectId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AtlasPageGrids_ScalePresetId",
                table: "AtlasPageGrids",
                column: "ScalePresetId");

            migrationBuilder.CreateIndex(
                name: "IX_AtlasPages_PageGridId_Label",
                table: "AtlasPages",
                columns: new[] { "PageGridId", "Label" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GeneratedPdfs_ProjectId",
                table: "GeneratedPdfs",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportantLocations_ProjectId",
                table: "ImportantLocations",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_TileSources_Key",
                table: "TileSources",
                column: "Key",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AtlasExtents");

            migrationBuilder.DropTable(
                name: "AtlasPages");

            migrationBuilder.DropTable(
                name: "GeneratedPdfs");

            migrationBuilder.DropTable(
                name: "ImportantLocations");

            migrationBuilder.DropTable(
                name: "TileSources");

            migrationBuilder.DropTable(
                name: "AtlasPageGrids");

            migrationBuilder.DropTable(
                name: "Projects");

            migrationBuilder.DropTable(
                name: "ScalePresets");
        }
    }
}
