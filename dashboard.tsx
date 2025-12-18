/**
 * Pipeline Debugger Dashboard
 * React components for the visual debugger UI
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import type {
  Pipeline,
  PipelineStage,
  StageResult,
  Detection,
  Classification,
  PointCloudData,
  ResourceType,
} from "./debugger";
import { PipelineDebugger, createDebugger } from "./debugger";
import { PointCloudRenderer, RenderOptions } from "./pointcloud-renderer";

// ============================================================================
// Types
// ============================================================================

export interface DashboardProps {
  /** Initial pipelines to display */
  pipelines?: Pipeline[];
  /** Connection details (if pre-configured) */
  connection?: {
    host: string;
    apiKey: string;
    apiKeyId: string;
  };
  /** Theme */
  theme?: "dark" | "light";
  /** Auto-refresh interval in ms (0 = disabled) */
  refreshInterval?: number;
}

interface ConnectionState {
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
}

// ============================================================================
// Hooks
// ============================================================================

function useDebugger() {
  const debuggerRef = useRef<PipelineDebugger | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "disconnected",
  });
  const [cameras, setCameras] = useState<string[]>([]);
  const [visionServices, setVisionServices] = useState<string[]>([]);

  const connect = useCallback(async (host: string, apiKey: string, apiKeyId: string) => {
    setConnectionState({ status: "connecting" });
    try {
      if (!debuggerRef.current) {
        debuggerRef.current = createDebugger();
      }
      await debuggerRef.current.connect(host, apiKey, apiKeyId);
      setCameras(debuggerRef.current.getCameras());
      setVisionServices(debuggerRef.current.getVisionServices());
      setConnectionState({ status: "connected" });
    } catch (error) {
      setConnectionState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (debuggerRef.current) {
      await debuggerRef.current.disconnect();
      debuggerRef.current = null;
    }
    setConnectionState({ status: "disconnected" });
    setCameras([]);
    setVisionServices([]);
  }, []);

  return {
    debugger: debuggerRef.current,
    connectionState,
    cameras,
    visionServices,
    connect,
    disconnect,
  };
}

// ============================================================================
// Components
// ============================================================================

/** Connection panel */
export function ConnectionPanel({
  onConnect,
  onDisconnect,
  state,
}: {
  onConnect: (host: string, apiKey: string, apiKeyId: string) => void;
  onDisconnect: () => void;
  state: ConnectionState;
}) {
  const [host, setHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");

  const handleConnect = () => {
    if (host && apiKey && apiKeyId) {
      onConnect(host, apiKey, apiKeyId);
    }
  };

  return (
    <div className="vpd-connection-panel">
      <input
        type="text"
        placeholder="Machine address (xxx.viam.cloud)"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        disabled={state.status === "connecting" || state.status === "connected"}
      />
      <input
        type="password"
        placeholder="API Key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        disabled={state.status === "connecting" || state.status === "connected"}
      />
      <input
        type="text"
        placeholder="API Key ID"
        value={apiKeyId}
        onChange={(e) => setApiKeyId(e.target.value)}
        disabled={state.status === "connecting" || state.status === "connected"}
      />

      {state.status !== "connected" ? (
        <button
          onClick={handleConnect}
          disabled={state.status === "connecting" || !host || !apiKey || !apiKeyId}
        >
          {state.status === "connecting" ? "Connecting..." : "Connect"}
        </button>
      ) : (
        <button onClick={onDisconnect} className="vpd-disconnect">
          Disconnect
        </button>
      )}

      <span className={`vpd-status vpd-status-${state.status}`}>
        {state.status === "connected" && "● Connected"}
        {state.status === "disconnected" && "○ Disconnected"}
        {state.status === "connecting" && "◐ Connecting..."}
        {state.status === "error" && `✕ ${state.error}`}
      </span>
    </div>
  );
}

/** Pipeline configuration panel */
export function PipelineConfig({
  pipelines,
  onPipelinesChange,
  cameras,
  visionServices,
}: {
  pipelines: Pipeline[];
  onPipelinesChange: (pipelines: Pipeline[]) => void;
  cameras: string[];
  visionServices: string[];
}) {
  const [newPipelineName, setNewPipelineName] = useState("");
  const [editingPipeline, setEditingPipeline] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageSource, setNewStageSource] = useState("");

  const addPipeline = () => {
    if (newPipelineName) {
      const id = `pipeline-${Date.now()}`;
      onPipelinesChange([
        ...pipelines,
        { id, name: newPipelineName, stages: [] },
      ]);
      setNewPipelineName("");
      setEditingPipeline(id);
    }
  };

  const removePipeline = (id: string) => {
    onPipelinesChange(pipelines.filter((p) => p.id !== id));
  };

  const addStage = (pipelineId: string) => {
    if (!newStageName) return;

    const stage: PipelineStage = {
      name: newStageName,
      sourceCamera: newStageSource || undefined,
    };

    onPipelinesChange(
      pipelines.map((p) =>
        p.id === pipelineId ? { ...p, stages: [...p.stages, stage] } : p
      )
    );

    setNewStageName("");
    setNewStageSource("");
  };

  const removeStage = (pipelineId: string, stageIndex: number) => {
    onPipelinesChange(
      pipelines.map((p) =>
        p.id === pipelineId
          ? { ...p, stages: p.stages.filter((_, i) => i !== stageIndex) }
          : p
      )
    );
  };

  return (
    <div className="vpd-pipeline-config">
      <div className="vpd-config-header">
        <h3>Pipelines</h3>
        <div className="vpd-add-pipeline">
          <input
            type="text"
            placeholder="New pipeline name"
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPipeline()}
          />
          <button onClick={addPipeline}>+ Add Pipeline</button>
        </div>
      </div>

      {pipelines.map((pipeline) => (
        <div key={pipeline.id} className="vpd-pipeline-item">
          <div className="vpd-pipeline-header">
            <span
              className="vpd-pipeline-name"
              onClick={() =>
                setEditingPipeline(
                  editingPipeline === pipeline.id ? null : pipeline.id
                )
              }
            >
              {editingPipeline === pipeline.id ? "▼" : "▶"} {pipeline.name}
            </span>
            <span className="vpd-stage-count">
              {pipeline.stages.length} stages
            </span>
            <button
              className="vpd-remove"
              onClick={() => removePipeline(pipeline.id)}
            >
              ✕
            </button>
          </div>

          {editingPipeline === pipeline.id && (
            <div className="vpd-pipeline-stages">
              {pipeline.stages.map((stage, idx) => (
                <div key={idx} className="vpd-stage-item">
                  <span className="vpd-stage-index">{idx + 1}</span>
                  <span className="vpd-stage-name">{stage.name}</span>
                  {stage.sourceCamera && (
                    <span className="vpd-stage-source">
                      ← {stage.sourceCamera}
                    </span>
                  )}
                  <button
                    className="vpd-remove"
                    onClick={() => removeStage(pipeline.id, idx)}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div className="vpd-add-stage">
                <select
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                >
                  <option value="">Select component...</option>
                  <optgroup label="Cameras">
                    {cameras.map((c) => (
                      <option key={c} value={c}>
                        📷 {c}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Vision Services">
                    {visionServices.map((v) => (
                      <option key={v} value={v}>
                        👁 {v}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {visionServices.includes(newStageName) && (
                  <select
                    value={newStageSource}
                    onChange={(e) => setNewStageSource(e.target.value)}
                  >
                    <option value="">Source camera...</option>
                    {cameras.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}

                <button onClick={() => addStage(pipeline.id)}>+ Add</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Image viewer with detection overlay */
export function ImageViewer({
  imageData,
  mimeType,
  detections,
  classifications,
}: {
  imageData?: Uint8Array;
  mimeType?: string;
  detections?: Detection[];
  classifications?: Classification[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!imageData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const blob = new Blob([imageData], { type: mimeType || "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      setImageSize({ width: img.width, height: img.height });

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Draw detections
      if (detections) {
        ctx.lineWidth = 2;
        ctx.font = "14px monospace";

        detections.forEach((det, i) => {
          const hue = (i * 137.5) % 360;
          ctx.strokeStyle = `hsl(${hue}, 80%, 50%)`;
          ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;

          // Bounding box
          ctx.strokeRect(
            det.xMin,
            det.yMin,
            det.xMax - det.xMin,
            det.yMax - det.yMin
          );

          // Label background
          const label = `${det.className} ${(det.confidence * 100).toFixed(0)}%`;
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = `hsla(${hue}, 80%, 20%, 0.8)`;
          ctx.fillRect(det.xMin, det.yMin - 20, textWidth + 8, 20);

          // Label text
          ctx.fillStyle = "#fff";
          ctx.fillText(label, det.xMin + 4, det.yMin - 5);
        });
      }

      // Draw classifications
      if (classifications && classifications.length > 0) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(10, 10, 200, classifications.length * 24 + 10);

        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        classifications.forEach((cls, i) => {
          const y = 28 + i * 24;
          ctx.fillText(
            `${cls.className}: ${(cls.confidence * 100).toFixed(1)}%`,
            20,
            y
          );

          // Confidence bar
          ctx.fillStyle = `hsl(${cls.confidence * 120}, 70%, 50%)`;
          ctx.fillRect(20, y + 4, cls.confidence * 150, 8);
          ctx.fillStyle = "#fff";
        });
      }

      URL.revokeObjectURL(url);
    };

    img.src = url;
  }, [imageData, mimeType, detections, classifications]);

  return (
    <div className="vpd-image-viewer">
      <canvas ref={canvasRef} />
      {imageSize.width > 0 && (
        <div className="vpd-image-info">
          {imageSize.width} × {imageSize.height}
        </div>
      )}
    </div>
  );
}

/** Point cloud viewer */
export function PointCloudViewer({
  data,
  options,
}: {
  data: PointCloudData;
  options?: Partial<RenderOptions>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PointCloudRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    rendererRef.current = new PointCloudRenderer(canvasRef.current, options);

    return () => {
      rendererRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (rendererRef.current && data) {
      rendererRef.current.setData(data);
    }
  }, [data]);

  useEffect(() => {
    if (rendererRef.current && options) {
      rendererRef.current.setOptions(options);
    }
  }, [options]);

  useEffect(() => {
    const handleResize = () => {
      rendererRef.current?.resize();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const bbox = data.boundingBox;
  const size = {
    x: (bbox.max.x - bbox.min.x).toFixed(1),
    y: (bbox.max.y - bbox.min.y).toFixed(1),
    z: (bbox.max.z - bbox.min.z).toFixed(1),
  };

  return (
    <div className="vpd-pointcloud-viewer" ref={containerRef}>
      <canvas ref={canvasRef} />
      <div className="vpd-pc-info">
        <span>{data.points.length.toLocaleString()} pts</span>
        <span>
          {size.x} × {size.y} × {size.z} mm
        </span>
        {data.normals && <span>✓ normals</span>}
      </div>
      <div className="vpd-pc-controls">
        <span>🖱 drag: rotate</span>
        <span>scroll: zoom</span>
      </div>
    </div>
  );
}

/** Detection list */
export function DetectionList({ detections }: { detections: Detection[] }) {
  if (detections.length === 0) {
    return <div className="vpd-no-data">No detections</div>;
  }

  return (
    <div className="vpd-detection-list">
      {detections.map((det, i) => (
        <div
          key={i}
          className={`vpd-detection-item ${
            det.confidence < 0.5 ? "vpd-low-confidence" : ""
          }`}
        >
          <span className="vpd-det-class">{det.className}</span>
          <span className="vpd-det-confidence">
            {(det.confidence * 100).toFixed(1)}%
          </span>
          <div className="vpd-confidence-bar">
            <div
              className="vpd-confidence-fill"
              style={{ width: `${det.confidence * 100}%` }}
            />
          </div>
          <span className="vpd-det-bbox">
            [{det.xMin}, {det.yMin}] → [{det.xMax}, {det.yMax}]
          </span>
        </div>
      ))}
    </div>
  );
}

/** Single stage display */
export function StagePanel({
  stage,
  result,
  onRefresh,
  pcOptions,
}: {
  stage: PipelineStage;
  result?: StageResult;
  onRefresh: () => void;
  pcOptions?: Partial<RenderOptions>;
}) {
  const statusClass = result
    ? result.success
      ? "vpd-success"
      : "vpd-error"
    : "vpd-pending";

  return (
    <div className={`vpd-stage-panel ${statusClass}`}>
      <div className="vpd-stage-header">
        <h4>{stage.label || stage.name}</h4>
        <div className="vpd-stage-meta">
          {result?.resourceType && (
            <span className="vpd-resource-type">{result.resourceType}</span>
          )}
          {result?.latencyMs !== undefined && (
            <span className="vpd-latency">{result.latencyMs}ms</span>
          )}
          <button className="vpd-refresh-btn" onClick={onRefresh}>
            ↻
          </button>
        </div>
      </div>

      <div className="vpd-stage-content">
        {result?.error && (
          <div className="vpd-error-message">{result.error}</div>
        )}

        {result?.image && (
          <ImageViewer
            imageData={result.image.data}
            mimeType={result.image.mimeType}
            detections={result.detections}
            classifications={result.classifications}
          />
        )}

        {result?.pointCloud && (
          <PointCloudViewer data={result.pointCloud} options={pcOptions} />
        )}

        {result?.detections && !result.image && (
          <DetectionList detections={result.detections} />
        )}

        {result?.objects && result.objects.length > 0 && (
          <div className="vpd-objects-list">
            <h5>3D Objects</h5>
            {result.objects.map((obj, i) => (
              <div key={i} className="vpd-object-item">
                <span>{obj.label}</span>
                <span>
                  ({obj.center.x.toFixed(1)}, {obj.center.y.toFixed(1)},{" "}
                  {obj.center.z.toFixed(1)})
                </span>
              </div>
            ))}
          </div>
        )}

        {!result && <div className="vpd-no-data">Click refresh to load</div>}
      </div>

      {stage.sourceCamera && (
        <div className="vpd-stage-source">← {stage.sourceCamera}</div>
      )}
    </div>
  );
}

/** Pipeline display */
export function PipelinePanel({
  pipeline,
  results,
  onRefresh,
  onRefreshAll,
  pcOptions,
}: {
  pipeline: Pipeline;
  results: Map<string, StageResult>;
  onRefresh: (stageName: string) => void;
  onRefreshAll: () => void;
  pcOptions?: Partial<RenderOptions>;
}) {
  return (
    <div className="vpd-pipeline-panel">
      <div className="vpd-pipeline-title">
        <h3>{pipeline.name}</h3>
        <button onClick={onRefreshAll}>Refresh All</button>
      </div>

      <div className="vpd-stages">
        {pipeline.stages.map((stage, i) => (
          <React.Fragment key={stage.name}>
            <StagePanel
              stage={stage}
              result={results.get(stage.name)}
              onRefresh={() => onRefresh(stage.name)}
              pcOptions={pcOptions}
            />
            {i < pipeline.stages.length - 1 && (
              <div className="vpd-flow-arrow">↓</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** Point cloud options panel */
export function PointCloudOptions({
  options,
  onChange,
}: {
  options: Partial<RenderOptions>;
  onChange: (options: Partial<RenderOptions>) => void;
}) {
  return (
    <div className="vpd-pc-options">
      <h4>Point Cloud Display</h4>
      <label>
        <input
          type="checkbox"
          checked={options.showNormals ?? true}
          onChange={(e) => onChange({ ...options, showNormals: e.target.checked })}
        />
        Show Normals
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.showBoundingBox ?? true}
          onChange={(e) =>
            onChange({ ...options, showBoundingBox: e.target.checked })
          }
        />
        Show Bounding Box
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.showAxes ?? true}
          onChange={(e) => onChange({ ...options, showAxes: e.target.checked })}
        />
        Show Axes
      </label>
      <label>
        <input
          type="checkbox"
          checked={options.colorByHeight ?? true}
          onChange={(e) =>
            onChange({ ...options, colorByHeight: e.target.checked })
          }
        />
        Color by Height
      </label>
      <label>
        Normal Length
        <input
          type="range"
          min="1"
          max="50"
          value={options.normalLength ?? 10}
          onChange={(e) =>
            onChange({ ...options, normalLength: parseInt(e.target.value) })
          }
        />
      </label>
      <label>
        Point Size
        <input
          type="range"
          min="1"
          max="10"
          value={options.pointSize ?? 2}
          onChange={(e) =>
            onChange({ ...options, pointSize: parseInt(e.target.value) })
          }
        />
      </label>
    </div>
  );
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export function PipelineDebuggerDashboard({
  pipelines: initialPipelines = [],
  connection,
  theme = "dark",
  refreshInterval = 0,
}: DashboardProps) {
  const {
    debugger: dbg,
    connectionState,
    cameras,
    visionServices,
    connect,
    disconnect,
  } = useDebugger();

  const [pipelines, setPipelines] = useState<Pipeline[]>(initialPipelines);
  const [results, setResults] = useState<Map<string, Map<string, StageResult>>>(
    new Map()
  );
  const [pcOptions, setPcOptions] = useState<Partial<RenderOptions>>({
    showNormals: true,
    showBoundingBox: true,
    showAxes: true,
    colorByHeight: true,
    normalLength: 10,
    pointSize: 2,
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showConfig, setShowConfig] = useState(true);

  // Auto-connect if connection provided
  useEffect(() => {
    if (connection && connectionState.status === "disconnected") {
      connect(connection.host, connection.apiKey, connection.apiKeyId);
    }
  }, [connection]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh || !dbg || refreshInterval <= 0) return;

    const interval = setInterval(async () => {
      for (const pipeline of pipelines) {
        const pipelineResults = await dbg.debugPipeline(pipeline);
        setResults((prev) => {
          const newResults = new Map(prev);
          const stageMap = new Map<string, StageResult>();
          pipelineResults.forEach((r) => stageMap.set(r.stageName, r));
          newResults.set(pipeline.id, stageMap);
          return newResults;
        });
      }
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, dbg, pipelines, refreshInterval]);

  const refreshStage = async (pipelineId: string, stageName: string) => {
    if (!dbg) return;

    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return;

    const stage = pipeline.stages.find((s) => s.name === stageName);
    if (!stage) return;

    // Find the previous camera in the pipeline for context
    const stageIndex = pipeline.stages.indexOf(stage);
    let sourceCamera = stage.sourceCamera;
    if (!sourceCamera) {
      for (let i = stageIndex - 1; i >= 0; i--) {
        if (dbg.getResourceType(pipeline.stages[i].name) === "camera") {
          sourceCamera = pipeline.stages[i].name;
          break;
        }
      }
    }

    const result = await dbg.debugStage({ ...stage, sourceCamera });

    setResults((prev) => {
      const newResults = new Map(prev);
      const pipelineMap = newResults.get(pipelineId) || new Map();
      pipelineMap.set(stageName, result);
      newResults.set(pipelineId, pipelineMap);
      return newResults;
    });
  };

  const refreshPipeline = async (pipelineId: string) => {
    if (!dbg) return;

    const pipeline = pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return;

    const pipelineResults = await dbg.debugPipeline(pipeline);

    setResults((prev) => {
      const newResults = new Map(prev);
      const stageMap = new Map<string, StageResult>();
      pipelineResults.forEach((r) => stageMap.set(r.stageName, r));
      newResults.set(pipelineId, stageMap);
      return newResults;
    });
  };

  const refreshAll = async () => {
    for (const pipeline of pipelines) {
      await refreshPipeline(pipeline.id);
    }
  };

  return (
    <div className={`vpd-dashboard vpd-theme-${theme}`}>
      <header className="vpd-header">
        <h1>Viam Pipeline Debugger</h1>
        <div className="vpd-controls">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={showConfig ? "vpd-active" : ""}
          >
            ⚙ Config
          </button>
          <button
            onClick={refreshAll}
            disabled={connectionState.status !== "connected"}
          >
            ↻ Refresh All
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "vpd-active" : ""}
            disabled={connectionState.status !== "connected"}
          >
            {autoRefresh ? "⏸ Stop" : "▶ Auto"}
          </button>
        </div>
      </header>

      <ConnectionPanel
        onConnect={connect}
        onDisconnect={disconnect}
        state={connectionState}
      />

      {showConfig && connectionState.status === "connected" && (
        <div className="vpd-config-section">
          <PipelineConfig
            pipelines={pipelines}
            onPipelinesChange={setPipelines}
            cameras={cameras}
            visionServices={visionServices}
          />
          <PointCloudOptions options={pcOptions} onChange={setPcOptions} />
        </div>
      )}

      <div className="vpd-pipelines">
        {pipelines.map((pipeline) => (
          <PipelinePanel
            key={pipeline.id}
            pipeline={pipeline}
            results={results.get(pipeline.id) || new Map()}
            onRefresh={(stageName) => refreshStage(pipeline.id, stageName)}
            onRefreshAll={() => refreshPipeline(pipeline.id)}
            pcOptions={pcOptions}
          />
        ))}

        {pipelines.length === 0 && (
          <div className="vpd-empty-state">
            <p>No pipelines configured.</p>
            <p>
              {connectionState.status === "connected"
                ? "Use the config panel above to add pipelines."
                : "Connect to a machine first."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PipelineDebuggerDashboard;
