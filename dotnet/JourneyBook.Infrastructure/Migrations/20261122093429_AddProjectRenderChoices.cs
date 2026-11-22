using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectRenderChoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MapTier",
                table: "Projects",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Worksheet",
                table: "Projects",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "WorksheetLandmarks",
                table: "Projects",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Projects_MapTier",
                table: "Projects",
                sql: "\"MapTier\" IS NULL OR \"MapTier\" BETWEEN 1 AND 4");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Projects_MapTier",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "MapTier",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "Worksheet",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "WorksheetLandmarks",
                table: "Projects");
        }
    }
}
