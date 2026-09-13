import type { StyleSpecification } from '@maplibre/maplibre-react-native';

// Authored geometry for checking the native renderer without a tile account or network.
// This is a fictional park around a fixed viewport, not a route or the device location.
export const sampleMapStyle: StyleSpecification = {
  version: 8,
  name: 'Ridr fictional sample park',
  sources: {
    park: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [73.842, 18.519],
                  [73.858, 18.519],
                  [73.862, 18.526],
                  [73.856, 18.533],
                  [73.842, 18.531],
                  [73.842, 18.519],
                ],
              ],
            },
          },
        ],
      },
    },
    path: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [73.835, 18.518],
                [73.844, 18.522],
                [73.846, 18.527],
                [73.851, 18.529],
                [73.857, 18.527],
                [73.863, 18.533],
              ],
            },
          },
        ],
      },
    },
    marker: {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [73.846, 18.527] },
      },
    },
  },
  layers: [
    { id: 'canvas', type: 'background', paint: { 'background-color': '#f3f1e8' } },
    { id: 'park', type: 'fill', source: 'park', paint: { 'fill-color': '#d7e8cc' } },
    {
      id: 'path-edge',
      type: 'line',
      source: 'path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 12 },
    },
    {
      id: 'path',
      type: 'line',
      source: 'path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#b7c6aa', 'line-width': 5 },
    },
    {
      id: 'marker',
      type: 'circle',
      source: 'marker',
      paint: {
        'circle-color': '#164d38',
        'circle-radius': 7,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 3,
      },
    },
  ],
};
