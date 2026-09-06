using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace JourneyBook.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLocationZoomLevels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "ZoomLevels",
                table: "ImportantLocations",
                type: "text[]",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ZoomLevels",
                table: "ImportantLocations");
        }
    }
}
