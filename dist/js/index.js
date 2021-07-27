'use strict';

var center = require('@turf/center');
var turfJsts = require('turf-jsts');
var meta = require('@turf/meta');
var d3Geo = require('d3-geo');
var helpers = require('@turf/helpers');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var center__default = /*#__PURE__*/_interopDefaultLegacy(center);

/**
 * Calculates a buffer for input features for a given radius. Units supported are miles, kilometers, and degrees.
 *
 * When using a negative radius, the resulting geometry may be invalid if
 * it's too small compared to the radius magnitude. If the input is a
 * FeatureCollection, only valid members will be returned in the output
 * FeatureCollection - i.e., the output collection may have fewer members than
 * the input, or even be empty.
 *
 * @name buffer
 * @param {FeatureCollection|Geometry|Feature<any>} geojson input to be buffered
 * @param {number} radius distance to draw the buffer (negative values are allowed)
 * @param {Object} [options={}] Optional parameters
 * @param {string} [options.units="kilometers"] any of the options supported by turf units
 * @param {string} [options.endCapStyle="round"] can be round, flat or square
 * @param {string} [options.joinStyle="round"] can be round, mitre or bevel
 * @param {number} [options.mitreLimit=5.0] limit of mitre join style
 * @param {number} [options.steps=8] number of steps
 * @returns {FeatureCollection|Feature<Polygon|MultiPolygon>|undefined} buffered features
 * @example
 * var point = turf.point([-90.548630, 14.616599]);
 * var buffered = turf.buffer(point, 500, {units: 'miles'});
 *
 * //addToMap
 * var addToMap = [point, buffered]
 */
function buffer(geojson, radius, options) {
  // Optional params
  options = options || {};

  // use user supplied options or default values
  var units = options.units || "kilometers";
  var steps = options.steps || 8;
  var endCapStyle = options.endCapStyle || "round";
  var joinStyle = options.joinStyle || "round";
  var mitreLimit = options.mitreLimit || 5.0;

  // validation
  if (!geojson) throw new Error("geojson is required");
  if (typeof options !== "object") throw new Error("options must be an object");
  if (typeof steps !== "number") throw new Error("steps must be a number");
  switch (endCapStyle) {
    case "round":
      endCapStyle = 1;
      break;
    case "flat":
      endCapStyle = 2;
      break;
    case "square":
      endCapStyle = 3;
      break;
    default:
      throw new Error("endCapStyle must be 'flat', 'round' or 'square'");
  }
  switch (joinStyle) {
    case "round":
      joinStyle = 1;
      break;
    case "mitre":
      joinStyle = 2;
      break;
    case "bevel":
      joinStyle = 3;
      break;
    default:
      throw new Error("joinStyle must be 'round', 'mitre' or 'bevel'");
  }
  if (typeof mitreLimit !== "number") throw new Error("mitreLimit must be a number");

  // Allow negative buffers ("erosion") or zero-sized buffers ("repair geometry")
  if (radius === undefined) throw new Error("radius is required");
  if (steps <= 0) throw new Error("steps must be greater than 0");

  var results = [];
  switch (geojson.type) {
    case "GeometryCollection":
      meta.geomEach(geojson, function (geometry) {
        var buffered = bufferFeature(
          helpers.feature,
          radius,
          units,
          steps,
          endCapStyle,
          joinStyle,
          mitreLimit
        );
        if (buffered) results.push(buffered);
      });
      return helpers.featureCollection(results);
    case "FeatureCollection":
      meta.featureEach(geojson, function (feature) {
        var multiBuffered = bufferFeature(
          feature,
          radius,
          units,
          steps,
          endCapStyle,
          joinStyle,
          mitreLimit
        );
        if (multiBuffered) {
          meta.featureEach(multiBuffered, function (buffered) {
            if (buffered) results.push(buffered);
          });
        }
      });
      return helpers.featureCollection(results);
  }
  return bufferFeature(geojson, radius, units, steps, endCapStyle, joinStyle, mitreLimit);
}

/**
 * Buffer single Feature/Geometry
 *
 * @private
 * @param {Feature<any>} geojson input to be buffered
 * @param {number} radius distance to draw the buffer
 * @param {string} [units='kilometers'] any of the options supported by turf units
 * @param {string} [endCapStyle='round'] can be round, flat or square
 * @param {number} [steps=8] number of steps
 * @returns {Feature<Polygon|MultiPolygon>} buffered feature
 */
function bufferFeature(geojson, radius, units, steps, endCapStyle, joinStyle, mitreLimit) {
  var properties = geojson.properties || {};
  var geometry = geojson.type === "Feature" ? geojson.geometry : geojson;

  // Geometry Types faster than jsts
  if (geometry.type === "GeometryCollection") {
    var results = [];
    meta.geomEach(geojson, function (geometry) {
      var buffered = bufferFeature(geometry, radius, units, steps, endCapStyle, joinStyle, mitreLimit);
      if (buffered) results.push(buffered);
    });
    return helpers.featureCollection(results);
  }

  // Project GeoJSON to Azimuthal Equidistant projection (convert to Meters)
  var projection = defineProjection(geometry);
  var projected = {
    type: geometry.type,
    coordinates: projectCoords(geometry.coordinates, projection),
  };

  // JSTS buffer operation
  var reader = new turfJsts.GeoJSONReader();
  var geom = reader.read(projected);
  var distance = helpers.radiansToLength(helpers.lengthToRadians(radius, units), "meters");
  var bufferOp = new turfJsts.BufferOp(geom);
  bufferOp.setQuadrantSegments(steps);
  bufferOp.setEndCapStyle(endCapStyle);
  bufferOp._bufParams.setJoinStyle(joinStyle);
  bufferOp._bufParams.setMitreLimit(mitreLimit);
  var buffered = bufferOp.getResultGeometry(distance);
  var writer = new turfJsts.GeoJSONWriter();
  buffered = writer.write(buffered);

  // Detect if empty geometries
  if (coordsIsNaN(buffered.coordinates)) return undefined;

  // Unproject coordinates (convert to Degrees)
  var result = {
    type: buffered.type,
    coordinates: unprojectCoords(buffered.coordinates, projection),
  };

  return helpers.feature(result, properties);
}

/**
 * Coordinates isNaN
 *
 * @private
 * @param {Array<any>} coords GeoJSON Coordinates
 * @returns {boolean} if NaN exists
 */
function coordsIsNaN(coords) {
  if (Array.isArray(coords[0])) return coordsIsNaN(coords[0]);
  return isNaN(coords[0]);
}

/**
 * Project coordinates to projection
 *
 * @private
 * @param {Array<any>} coords to project
 * @param {GeoProjection} proj D3 Geo Projection
 * @returns {Array<any>} projected coordinates
 */
function projectCoords(coords, proj) {
  if (typeof coords[0] !== "object") return proj(coords);
  return coords.map(function (coord) {
    return projectCoords(coord, proj);
  });
}

/**
 * Un-Project coordinates to projection
 *
 * @private
 * @param {Array<any>} coords to un-project
 * @param {GeoProjection} proj D3 Geo Projection
 * @returns {Array<any>} un-projected coordinates
 */
function unprojectCoords(coords, proj) {
  if (typeof coords[0] !== "object") return proj.invert(coords);
  return coords.map(function (coord) {
    return unprojectCoords(coord, proj);
  });
}

/**
 * Define Azimuthal Equidistant projection
 *
 * @private
 * @param {Geometry|Feature<any>} geojson Base projection on center of GeoJSON
 * @returns {GeoProjection} D3 Geo Azimuthal Equidistant Projection
 */
function defineProjection(geojson) {
  var coords = center__default['default'](geojson).geometry.coordinates;
  var rotation = [-coords[0], -coords[1]];
  return d3Geo.geoAzimuthalEquidistant().rotate(rotation).scale(helpers.earthRadius);
}

module.exports = buffer;
module.exports.default = buffer;
