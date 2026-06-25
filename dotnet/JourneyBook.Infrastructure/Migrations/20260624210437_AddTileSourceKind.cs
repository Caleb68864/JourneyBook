using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTileSourceKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "TileSources",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "usgs-raster");

            migrationBuilder.UpdateData(
                table: "TileSources",
                keyColumn: "Id",
                keyValue: new Guid("11111111-1111-1111-1111-111111111111"),
                column: "Kind",
                value: "usgs-raster");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Kind",
                table: "TileSources");
        }
    }
}
