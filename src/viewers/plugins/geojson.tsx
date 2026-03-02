import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import L from "leaflet";
import {
  getFileMeta,
  prepareGeoJsonTiles,
  readGeoJsonTile,
  releaseGeoJsonTiles
} from "../../lib/tauri";
import type { GeoJsonPrepareProgressData, GeoJsonTileSessionData } from "../../types";

interface GeoJsonMapViewerProps {
  geojson: GeoJSON.GeoJsonObject;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

interface GeoJsonTileMapViewerProps {
  filePath: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

type ResolutionMode = "auto" | "low" | "medium" | "high";

const NARROW_LAYOUT_WIDTH = 1100;

function createProgressRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `geojson-progress-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function useIsNarrowLayout(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < NARROW_LAYOUT_WIDTH;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => {
      setIsNarrow(window.innerWidth < NARROW_LAYOUT_WIDTH);
    };

    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isNarrow;
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

function GeoJsonPropertiesBody({
  selectedFeature
}: {
  selectedFeature: GeoJSON.Feature | null;
}) {
  const title = getFeatureSummary(selectedFeature ?? undefined);
  const properties = formatProperties(selectedFeature ?? undefined);

  return (
    <div className="geojson-properties-inner">
      <div className="geojson-properties-title">{title}</div>
      <pre className="geojson-properties-pre">{properties}</pre>
    </div>
  );
}

export function GeoJsonMapViewer({ geojson, contentRef }: GeoJsonMapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string>("Hover a feature");
  const [selectedFeature, setSelectedFeature] = useState<GeoJSON.Feature | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isNarrow = useIsNarrowLayout();

  const normalizedGeoJson = useMemo(() => geojson, [geojson]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true
    });
    map.on("click", () => {
      setSelectedFeature(null);
      setDrawerOpen(false);
      setPanelOpen(false);
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

    setSelectedFeature(null);
    if (!isNarrow) {
      setDrawerOpen(false);
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
          L.DomEvent.stopPropagation(event);
          setSelectedFeature(feature);
          if (isNarrow) {
            setDrawerOpen(true);
          } else {
            setPanelOpen(true);
          }
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
  }, [normalizedGeoJson, isNarrow]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.invalidateSize();
  }, [isNarrow, drawerOpen, panelOpen, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    if (isNarrow) {
      setPanelOpen(false);
      return;
    }
    setDrawerOpen(false);
  }, [isNarrow]);

  return (
    <div ref={contentRef} className={`geojson-view${isFullscreen ? " is-fullscreen" : ""}`}>
      <div className="geojson-status">
        <div className="geojson-status-left">{hoverInfo}</div>
        <div className="geojson-status-right">
          <button
            type="button"
            className="geojson-properties-toggle"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? "戻す" : "全画面"}
          </button>
          {isNarrow && (
            <button
              type="button"
              className="geojson-properties-toggle"
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              {drawerOpen ? "閉じる" : "Properties"}
            </button>
          )}
          {!isNarrow && (
            <button
              type="button"
              className="geojson-properties-toggle"
              onClick={() => setPanelOpen((prev) => !prev)}
            >
              {panelOpen ? "Properties非表示" : "Properties表示"}
            </button>
          )}
        </div>
      </div>
      <div className="geojson-content">
        <div className="geojson-map-wrap">
          <div ref={mapContainerRef} className="geojson-map" />
          {!isNarrow && panelOpen && (
            <aside className="geojson-properties-panel is-overlay">
              <GeoJsonPropertiesBody selectedFeature={selectedFeature} />
            </aside>
          )}
          {isNarrow && drawerOpen && (
            <aside className="geojson-properties-panel is-overlay is-drawer-overlay">
              <GeoJsonPropertiesBody selectedFeature={selectedFeature} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z;
  return Math.floor(((lng + 180) / 360) * n);
}

function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return Math.floor((1 - mercator / Math.PI) / 2 * n);
}

function getVisibleTileKeys(bounds: L.LatLngBounds, z: number): string[] {
  const n = 2 ** z;
  const west = bounds.getWest();
  const east = bounds.getEast();
  const north = clamp(bounds.getNorth(), -85.05112878, 85.05112878);
  const south = clamp(bounds.getSouth(), -85.05112878, 85.05112878);

  const minX = clamp(lngToTileX(west, z), 0, n - 1);
  const maxX = clamp(lngToTileX(east, z), 0, n - 1);
  const minY = clamp(latToTileY(north, z), 0, n - 1);
  const maxY = clamp(latToTileY(south, z), 0, n - 1);

  const keys: string[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      keys.push(`${z}/${x}/${y}`);
    }
  }
  return keys;
}

export function GeoJsonTileMapViewer({ filePath, contentRef }: GeoJsonTileMapViewerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const tileCacheRef = useRef<Map<string, GeoJSON.Feature[]>>(new Map());
  const tileStatsRef = useRef<
    Map<string, {
      truncated: boolean;
      simplifiedFeatures: number;
      fallbackFeatures: number;
      lodTolerance: number;
      lodMode: "low" | "medium" | "high";
    }>
  >(new Map());
  const inflightRef = useRef<Set<string>>(new Set());
  const resolvedAutoModeRef = useRef<"low" | "medium" | "high" | null>(null);
  const currentProgressRequestIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const [session, setSession] = useState<GeoJsonTileSessionData | null>(null);
  const [hoverInfo, setHoverInfo] = useState<string>("Hover a feature");
  const [selectedFeature, setSelectedFeature] = useState<GeoJSON.Feature | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [status, setStatus] = useState<string>("Preparing GeoJSON tiles...");
  const [error, setError] = useState<string | null>(null);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>("auto");
  const [deviceCores, setDeviceCores] = useState<number | null>(null);
  const [deviceMemory, setDeviceMemory] = useState<number | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const isNarrow = useIsNarrowLayout();

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true
    });
    map.on("click", () => {
      setSelectedFeature(null);
      setDrawerOpen(false);
      setPanelOpen(false);
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
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & { deviceMemory?: number; };
      if (typeof nav.hardwareConcurrency === "number" && Number.isFinite(nav.hardwareConcurrency)) {
        setDeviceCores(nav.hardwareConcurrency);
      }
      if (typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory)) {
        setDeviceMemory(nav.deviceMemory);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const meta = await getFileMeta(filePath);
        if (!cancelled) {
          setFileSizeBytes(meta.sizeBytes);
        }
      } catch {
        if (!cancelled) {
          setFileSizeBytes(null);
        }
      }
    };
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    let currentDatasetId: string | null = null;
    let removeProgressListener: (() => void) | null = null;

    const prepare = async () => {
      const progressRequestId = createProgressRequestId();
      currentProgressRequestIdRef.current = progressRequestId;
      setError(null);
      setSession(null);
      setSelectedFeature(null);
      setDrawerOpen(false);
      setPanelOpen(true);
      tileCacheRef.current.clear();
      tileStatsRef.current.clear();
      inflightRef.current.clear();
      resolvedAutoModeRef.current = null;
      setStatus("Preparing GeoJSON tiles...");

      try {
        removeProgressListener = await listen<GeoJsonPrepareProgressData>(
          "geojson_prepare_progress",
          (event) => {
            const payload = event.payload;
            if (payload.requestId !== currentProgressRequestIdRef.current) {
              return;
            }
            setStatus(payload.message);
          }
        );
        if (cancelled) {
          removeProgressListener();
          removeProgressListener = null;
          return;
        }
        const created = await prepareGeoJsonTiles(filePath, {
          maxFeaturesPerTile: 1200,
          minZoom: 0,
          maxZoom: 12,
          progressRequestId
        });
        currentDatasetId = created.datasetId;
        if (cancelled) {
          await releaseGeoJsonTiles(created.datasetId);
          return;
        }
        setSession(created);
        setStatus(`Prepared ${created.totalFeatures.toLocaleString()} features`);

        if (mapRef.current && created.bounds) {
          const [minLng, minLat, maxLng, maxLat] = created.bounds;
          mapRef.current.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [20, 20] });
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setStatus("Failed to prepare GeoJSON tiles");
        }
      } finally {
        if (removeProgressListener) {
          removeProgressListener();
          removeProgressListener = null;
        }
      }
    };

    void prepare();

    return () => {
      cancelled = true;
      currentProgressRequestIdRef.current = null;
      if (removeProgressListener) {
        removeProgressListener();
      }
      const datasetId = currentDatasetId;
      if (datasetId) {
        void releaseGeoJsonTiles(datasetId);
      }
    };
  }, [filePath]);

  const refreshVisibleTiles = useCallback(async () => {
    if (!mapRef.current || !session) return;

    const map = mapRef.current;
    const z = clamp(Math.round(map.getZoom()), session.minZoom, session.maxZoom);
    const keys = getVisibleTileKeys(map.getBounds(), z);
    const seq = ++loadSeqRef.current;

    const fetches: Promise<void>[] = [];
    let truncatedTiles = 0;

    for (const key of keys) {
      if (tileCacheRef.current.has(key) || inflightRef.current.has(key)) {
        continue;
      }

      const [zPart, xPart, yPart] = key.split("/");
      const tileZ = Number(zPart);
      const tileX = Number(xPart);
      const tileY = Number(yPart);

      inflightRef.current.add(key);
      const effectiveMode = resolutionMode === "auto"
        ? (resolvedAutoModeRef.current ?? "auto")
        : resolutionMode;
      fetches.push(
        readGeoJsonTile(session.datasetId, tileZ, tileX, tileY, {
          resolutionMode: effectiveMode,
          autoCpuCores: effectiveMode === "auto" ? (deviceCores ?? undefined) : undefined,
          autoDeviceMemoryGb: effectiveMode === "auto" ? (deviceMemory ?? undefined) : undefined
        })
          .then((tile) => {
            if (resolutionMode === "auto" && !resolvedAutoModeRef.current) {
              resolvedAutoModeRef.current = tile.lodMode;
            }
            tileCacheRef.current.set(key, tile.features);
            tileStatsRef.current.set(key, {
              truncated: tile.truncated,
              simplifiedFeatures: tile.simplifiedFeatures,
              fallbackFeatures: tile.fallbackFeatures,
              lodTolerance: tile.lodTolerance,
              lodMode: tile.lodMode
            });
          })
          .catch(() => {
            tileCacheRef.current.set(key, []);
            tileStatsRef.current.set(key, {
              truncated: false,
              simplifiedFeatures: 0,
              fallbackFeatures: 0,
              lodTolerance: 0,
              lodMode: "medium"
            });
          })
          .finally(() => {
            inflightRef.current.delete(key);
          })
      );
    }

    if (fetches.length > 0) {
      await Promise.all(fetches);
    }
    if (seq !== loadSeqRef.current) return;

    const visibleFeatures: GeoJSON.Feature[] = [];
    let simplifiedFeatures = 0;
    let fallbackFeatures = 0;
    let toleranceMax = 0;
    const modeCount = { low: 0, medium: 0, high: 0 };
    for (const key of keys) {
      const features = tileCacheRef.current.get(key);
      if (features) {
        visibleFeatures.push(...features);
      }
      const stats = tileStatsRef.current.get(key);
      if (stats) {
        if (stats.truncated) truncatedTiles += 1;
        simplifiedFeatures += stats.simplifiedFeatures;
        fallbackFeatures += stats.fallbackFeatures;
        toleranceMax = Math.max(toleranceMax, stats.lodTolerance);
        modeCount[stats.lodMode] += 1;
      }
    }
    const resolvedMode = modeCount.low >= modeCount.medium && modeCount.low >= modeCount.high
      ? "low"
      : modeCount.medium >= modeCount.high
      ? "medium"
      : "high";

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: visibleFeatures
    };
    const layer = L.geoJSON(
      collection,
      {
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
          targetLayer.on("mouseover", () => setHoverInfo(getFeatureSummary(feature)));
          targetLayer.on("mouseout", () => setHoverInfo("Hover a feature"));
          targetLayer.on("click", (event) => {
            L.DomEvent.stopPropagation(event);
            setSelectedFeature(feature);
            if (isNarrow) {
              setDrawerOpen(true);
            } else {
              setPanelOpen(true);
            }
          });
        }
      }
    );

    layer.addTo(map);
    layerRef.current = layer;
    setStatus(
      truncatedTiles > 0
        ? `Tiles ${keys.length} / features ${visibleFeatures.length.toLocaleString()} / simplified ${simplifiedFeatures.toLocaleString()} / fallback ${fallbackFeatures.toLocaleString()} / tol ${
          toleranceMax.toPrecision(3)
        } (some truncated)`
        : `Tiles ${keys.length} / features ${visibleFeatures.length.toLocaleString()} / simplified ${simplifiedFeatures.toLocaleString()} / fallback ${fallbackFeatures.toLocaleString()} / tol ${
          toleranceMax.toPrecision(3)
        } / mode ${resolvedMode}`
    );
  }, [session, resolutionMode, deviceCores, deviceMemory, isNarrow]);

  useEffect(() => {
    if (!mapRef.current || !session) return;
    const map = mapRef.current;

    const update = () => {
      void refreshVisibleTiles();
    };

    map.on("moveend", update);
    map.on("zoomend", update);
    update();

    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [session, refreshVisibleTiles]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.invalidateSize();
  }, [isNarrow, drawerOpen, panelOpen, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    if (isNarrow) {
      setPanelOpen(false);
      return;
    }
    setDrawerOpen(false);
  }, [isNarrow]);

  return (
    <div ref={contentRef} className={`geojson-view${isFullscreen ? " is-fullscreen" : ""}`}>
      <div className="geojson-status">
        <div className="geojson-status-left">{error ? error : `${status} | ${hoverInfo}`}</div>
        <div className="geojson-status-right">
          <button
            type="button"
            className="geojson-properties-toggle"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? "戻す" : "全画面"}
          </button>
          <span className="geojson-resolution-label">解像度</span>
          <select
            className="geojson-resolution-select"
            value={resolutionMode}
            onChange={(event) => {
              setResolutionMode(event.target.value as ResolutionMode);
              tileCacheRef.current.clear();
              tileStatsRef.current.clear();
              loadSeqRef.current += 1;
              if (mapRef.current) {
                mapRef.current.fire("moveend");
              }
            }}
          >
            <option value="auto">自動</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
          {resolutionMode === "auto" && (
            <span className="geojson-resolution-meta">
              {fileSizeBytes ? `${Math.round(fileSizeBytes / (1024 * 1024))}MB` : "-"}
              {deviceCores ? ` / ${deviceCores}C` : ""}
              {deviceMemory ? ` / ${deviceMemory}GB` : ""}
            </span>
          )}
          {isNarrow && (
            <button
              type="button"
              className="geojson-properties-toggle"
              onClick={() => setDrawerOpen((prev) => !prev)}
            >
              {drawerOpen ? "閉じる" : "Properties"}
            </button>
          )}
          {!isNarrow && (
            <button
              type="button"
              className="geojson-properties-toggle"
              onClick={() => setPanelOpen((prev) => !prev)}
            >
              {panelOpen ? "Properties非表示" : "Properties表示"}
            </button>
          )}
        </div>
      </div>
      <div className="geojson-content">
        <div className="geojson-map-wrap">
          <div ref={mapContainerRef} className="geojson-map" />
          {!isNarrow && panelOpen && (
            <aside className="geojson-properties-panel is-overlay">
              <GeoJsonPropertiesBody selectedFeature={selectedFeature} />
            </aside>
          )}
          {isNarrow && drawerOpen && (
            <aside className="geojson-properties-panel is-overlay is-drawer-overlay">
              <GeoJsonPropertiesBody selectedFeature={selectedFeature} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
