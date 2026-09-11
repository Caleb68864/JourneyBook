namespace JourneyBook.Application.Common;

/// <summary>
/// A WGS84 bounding box: west, south, east, north, in degrees.
/// </summary>
/// <remarks>
/// <para>
/// One record, in a feature-neutral namespace, because there were two identical
/// ones in the same assembly — <c>BBoxDto</c> in <c>Application.Projects</c> and
/// <c>RenderBBoxDto</c> in <c>Application.Rendering</c> — and the second had
/// quietly become a shared kernel. <c>IOverpassClient</c> and
/// <c>ImportLandmarksRequest</c> both opened with
/// <c>using JourneyBook.Application.Rendering;</c> and took the RENDERING extent
/// type, for no reason other than that it was there first: any change to the render
/// extent contract was a breaking change to the landmark import API.
/// </para>
/// <para>
/// Two identical records in one assembly is also two things that drift
/// independently, with nothing to notice. A shared kernel is fine; a shared kernel
/// that is a feature's own DTO by accident is not, and the fix is to say so in the
/// namespace.
/// </para>
/// <para>
/// This stays a C# concern. The engine's <c>BBox</c> is a <c>[W, S, E, N]</c> tuple
/// because the geometry is TypeScript's (ADR 0004) and a tuple is what
/// <c>buildPageGrid</c> and <c>enclosingBBox</c> take; the conversion happens once,
/// on the wire, in <c>HttpRenderWorkerClient</c> and in the web client's
/// <c>toBBox</c>. Those are translations between languages, not copies of a type.
/// </para>
/// </remarks>
public record BBoxDto(double West, double South, double East, double North);
