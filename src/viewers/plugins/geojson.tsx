import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";

interface GeoJsonMapViewerProps {
  geojson: GeoJSON.GeoJsonObject;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

function getFeatureSummary(feature: GeoJSON.Feature | undefined): string {
  if (!feature) return "Feature";

  const geometryType = feature.geometry?.type ?? "null";
  const propertyCount = feature.properties
    ? Object.keys(feature.properties as Record<string, unknown>).length
    : 0;

  return `${geometryType} / properties: ${propertyCount}`;
}

function formatProperties(feature: GeoJSON.Feature | undefined): string {
  if (!feature) return "No feature selected.";
  if (!feature.properties) return "No properties";
  return JSON.stringify(feature.properties, null, 2);
}

export function GeoJsonMapViewer({ geojson, contentRef }: GeoJsonMapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string>("Hover a feature");

  const normalizedGeoJson = useMemo(() => geojson, [geojson]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
    }).addTo(map);

    map.setView([35.681236, 139.767125], 3);
    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    const layer = L.geoJSON(normalizedGeoJson, {
      style: {
        color: "#2a85ff",
        weight: 2,
        opacity: 0.9,
        fillColor: "#2a85ff",
        fillOpacity: 0.2
      },
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          color: "#2a85ff",
          weight: 2,
          fillColor: "#4aa3ff",
          fillOpacity: 0.8
        }),
      onEachFeature: (feature, targetLayer) => {
        targetLayer.on("mouseover", () => {
          setHoverInfo(getFeatureSummary(feature));
        });
        targetLayer.on("mouseout", () => {
          setHoverInfo("Hover a feature");
        });
        targetLayer.on("click", (event) => {
          const title = getFeatureSummary(feature);
          const properties = formatProperties(feature);
          const escapedProperties = properties
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          targetLayer.bindPopup(
            `<div style="min-width:220px;max-width:360px;">`
              + `<div style="margin-bottom:6px;font-weight:600;">${title}</div>`
              + `<pre style="margin:0;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">${escapedProperties}</pre>`
              + `</div>`
          ).openPopup(event.latlng);
        });
      }
    });

    layer.addTo(mapRef.current);
    layerRef.current = layer;

    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    } else {
      mapRef.current.setView([35.681236, 139.767125], 3);
    }
  }, [normalizedGeoJson]);

  return (
    <div ref={contentRef} className="geojson-view">
      <div className="geojson-status">{hoverInfo}</div>
      <div ref={mapContainerRef} className="geojson-map" />
    </div>
  );
}
