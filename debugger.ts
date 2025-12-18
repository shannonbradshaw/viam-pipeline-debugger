/**
 * Viam Pipeline Debugger
 * A general-purpose visual debugging tool for Viam component pipelines
 */

import * as VIAM from "@viamrobotics/sdk";

// ============================================================================
// Types
// ============================================================================

export type ResourceType = 
  | "camera" 
  | "vision" 
  | "mlmodel" 
  | "sensor" 
  | "generic"
  | "unknown";

export interface PipelineStage {
  /** Resource name as configured in Viam */
  name: string;
  /** Optional display label */
  label?: string;
  /** For vision services: which camera to get detections from */
  sourceCamera?: string;
}

export interface Pipeline {
  /** Pipeline identifier */
  id: string;
  /** Display name */
  name: string;
  /** Ordered list of stages */
  stages: PipelineStage[];
}

export interface Detection {
  className: string;
  confidence: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface Classification {
  className: string;
  confidence: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface PointCloudData {
  points: Point3D[];
  normals?: Point3D[];
  colors?: Array<{ r: number; g: number; b: number }>;
  boundingBox: {
    min: Point3D;
    max: Point3D;
  };
}

export interface StageResult {
  stageName: string;
  stageLabel: string;
  resourceType: ResourceType;
  timestamp: Date;
  latencyMs: number;
  success: boolean;
  error?: string;

  // Camera data
  image?: {
    data: Uint8Array;
    mimeType: string;
    width?: number;
    height?: number;
  };

  // Point cloud data
  pointCloud?: PointCloudData;

  // Vision service data
  detections?: Detection[];
  classifications?: Classification[];

  // 3D segmentation data
  objects?: Array<{
    label: string;
    center: Point3D;
    pointCount: number;
    geometry?: any;
  }>;

  // Properties (what the service supports)
  properties?: {
    detectionsSupported: boolean;
    classificationsSupported: boolean;
    objectPointCloudsSupported: boolean;
  };
}

export interface DebuggerConfig {
  /** Refresh interval in milliseconds (0 = manual only) */
  refreshInterval?: number;
  /** Whether to auto-detect resource types */
  autoDetectTypes?: boolean;
  /** Default camera for vision services without explicit source */
  defaultCamera?: string;
}

// ============================================================================
// Resource Type Detection
// ============================================================================

export function parseResourceName(fullName: string): {
  namespace: string;
  type: string;
  subtype: string;
  name: string;
} {
  // Format: namespace:type:subtype/name or just name
  const match = fullName.match(/^(?:([^:]+):([^:]+):([^/]+)\/)?(.+)$/);
  if (match) {
    return {
      namespace: match[1] || "rdk",
      type: match[2] || "component",
      subtype: match[3] || "unknown",
      name: match[4],
    };
  }
  return { namespace: "rdk", type: "component", subtype: "unknown", name: fullName };
}

export function inferResourceType(resourceNames: VIAM.ResourceName[], name: string): ResourceType {
  const resource = resourceNames.find(r => r.name === name);
  if (!resource) return "unknown";

  const subtype = resource.subtype?.toLowerCase() || "";
  
  if (subtype === "camera") return "camera";
  if (subtype === "vision") return "vision";
  if (subtype === "mlmodel") return "mlmodel";
  if (subtype === "sensor") return "sensor";
  if (subtype === "generic") return "generic";
  
  return "unknown";
}

// ============================================================================
// Point Cloud Parsing
// ============================================================================

/**
 * Parse PCD (Point Cloud Data) format
 * Supports ASCII and binary formats
 */
export function parsePCD(data: Uint8Array): PointCloudData {
  const text = new TextDecoder().decode(data);
  const lines = text.split("\n");
  
  let format = "ascii";
  let pointCount = 0;
  let fields: string[] = [];
  let dataStartLine = 0;
  
  // Parse header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("FIELDS")) {
      fields = line.split(/\s+/).slice(1);
    } else if (line.startsWith("POINTS")) {
      pointCount = parseInt(line.split(/\s+/)[1], 10);
    } else if (line.startsWith("DATA")) {
      format = line.split(/\s+/)[1];
      dataStartLine = i + 1;
      break;
    }
  }

  const points: Point3D[] = [];
  const normals: Point3D[] = [];
  const colors: Array<{ r: number; g: number; b: number }> = [];

  const hasNormals = fields.includes("normal_x") || fields.includes("nx");
  const hasColors = fields.includes("rgb") || fields.includes("r");

  const xIdx = fields.indexOf("x");
  const yIdx = fields.indexOf("y");
  const zIdx = fields.indexOf("z");
  const nxIdx = fields.includes("normal_x") ? fields.indexOf("normal_x") : fields.indexOf("nx");
  const nyIdx = fields.includes("normal_y") ? fields.indexOf("normal_y") : fields.indexOf("ny");
  const nzIdx = fields.includes("normal_z") ? fields.indexOf("normal_z") : fields.indexOf("nz");

  if (format === "ascii") {
    for (let i = dataStartLine; i < lines.length && points.length < pointCount; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 3) {
        const x = parseFloat(parts[xIdx >= 0 ? xIdx : 0]);
        const y = parseFloat(parts[yIdx >= 0 ? yIdx : 1]);
        const z = parseFloat(parts[zIdx >= 0 ? zIdx : 2]);
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          points.push({ x, y, z });
          
          if (hasNormals && nxIdx >= 0) {
            normals.push({
              x: parseFloat(parts[nxIdx]),
              y: parseFloat(parts[nyIdx]),
              z: parseFloat(parts[nzIdx]),
            });
          }
        }
      }
    }
  }

  // Calculate bounding box
  const boundingBox = calculateBoundingBox(points);

  return {
    points,
    normals: normals.length > 0 ? normals : undefined,
    colors: colors.length > 0 ? colors : undefined,
    boundingBox,
  };
}

function calculateBoundingBox(points: Point3D[]): { min: Point3D; max: Point3D } {
  if (points.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    };
  }

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }

  return { min, max };
}

// ============================================================================
// Pipeline Debugger Class
// ============================================================================

export class PipelineDebugger {
  private machine: VIAM.RobotClient | null = null;
  private resourceNames: VIAM.ResourceName[] = [];
  private config: DebuggerConfig;
  private streams: Map<string, MediaStream> = new Map();
  private refreshTimer: number | null = null;

  constructor(config: DebuggerConfig = {}) {
    this.config = {
      refreshInterval: 0,
      autoDetectTypes: true,
      ...config,
    };
  }

  // --------------------------------------------------------------------------
  // Connection
  // --------------------------------------------------------------------------

  async connect(host: string, apiKey: string, apiKeyId: string): Promise<void> {
    this.machine = await VIAM.createRobotClient({
      host,
      credentials: {
        type: "api-key",
        payload: apiKey,
        authEntity: apiKeyId,
      },
      signalingAddress: "https://app.viam.com:443",
    });

    this.resourceNames = await this.machine.resourceNames();
  }

  async disconnect(): Promise<void> {
    this.stopAutoRefresh();
    this.stopAllStreams();
    
    if (this.machine) {
      await this.machine.disconnect();
      this.machine = null;
    }
    this.resourceNames = [];
  }

  isConnected(): boolean {
    return this.machine !== null;
  }

  // --------------------------------------------------------------------------
  // Resource Discovery
  // --------------------------------------------------------------------------

  getResourceNames(): VIAM.ResourceName[] {
    return this.resourceNames;
  }

  getCameras(): string[] {
    return this.resourceNames
      .filter(r => r.subtype === "camera")
      .map(r => r.name);
  }

  getVisionServices(): string[] {
    return this.resourceNames
      .filter(r => r.subtype === "vision")
      .map(r => r.name);
  }

  getResourceType(name: string): ResourceType {
    return inferResourceType(this.resourceNames, name);
  }

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------

  async getCameraImage(cameraName: string): Promise<{ data: Uint8Array; mimeType: string }> {
    if (!this.machine) throw new Error("Not connected");
    const camera = new VIAM.CameraClient(this.machine, cameraName);
    const mimeType = "image/jpeg";
    const data = await camera.getImage(mimeType);
    return { data, mimeType };
  }

  async getPointCloud(cameraName: string): Promise<PointCloudData> {
    if (!this.machine) throw new Error("Not connected");
    const camera = new VIAM.CameraClient(this.machine, cameraName);
    const result = await camera.getPointCloud();
    return parsePCD(result.data);
  }

  async getDetections(visionName: string, cameraName: string): Promise<Detection[]> {
    if (!this.machine) throw new Error("Not connected");
    const vision = new VIAM.VisionClient(this.machine, visionName);
    const detections = await vision.getDetectionsFromCamera(cameraName);
    return detections.map(d => ({
      className: d.className ?? "unknown",
      confidence: d.confidence ?? 0,
      xMin: d.xMin ?? 0,
      yMin: d.yMin ?? 0,
      xMax: d.xMax ?? 0,
      yMax: d.yMax ?? 0,
    }));
  }

  async getClassifications(
    visionName: string,
    cameraName: string,
    count: number = 5
  ): Promise<Classification[]> {
    if (!this.machine) throw new Error("Not connected");
    const vision = new VIAM.VisionClient(this.machine, visionName);
    const classifications = await vision.getClassificationsFromCamera(cameraName, count);
    return classifications.map(c => ({
      className: c.className ?? "unknown",
      confidence: c.confidence ?? 0,
    }));
  }

  async getObjectPointClouds(visionName: string, cameraName: string) {
    if (!this.machine) throw new Error("Not connected");
    const vision = new VIAM.VisionClient(this.machine, visionName);
    return await vision.getObjectPointClouds(cameraName);
  }

  async getVisionProperties(visionName: string) {
    if (!this.machine) throw new Error("Not connected");
    const vision = new VIAM.VisionClient(this.machine, visionName);
    return await vision.getProperties();
  }

  async captureAll(visionName: string, cameraName: string) {
    if (!this.machine) throw new Error("Not connected");
    const vision = new VIAM.VisionClient(this.machine, visionName);
    return await vision.captureAllFromCamera(cameraName, {
      returnImage: true,
      returnDetections: true,
      returnClassifications: true,
      returnObjectPointClouds: true,
    });
  }

  // --------------------------------------------------------------------------
  // Streaming
  // --------------------------------------------------------------------------

  async startStream(cameraName: string, videoElement: HTMLVideoElement): Promise<void> {
    if (!this.machine) throw new Error("Not connected");

    // Stop existing stream
    const existing = this.streams.get(cameraName);
    if (existing) {
      existing.getTracks().forEach(track => track.stop());
    }

    const streamClient = new VIAM.StreamClient(this.machine);
    const mediaStream = await streamClient.getStream(cameraName);
    this.streams.set(cameraName, mediaStream);

    videoElement.srcObject = mediaStream;
    videoElement.muted = true;
    await videoElement.play();
  }

  stopStream(cameraName: string): void {
    const stream = this.streams.get(cameraName);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      this.streams.delete(cameraName);
    }
  }

  stopAllStreams(): void {
    this.streams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop());
    });
    this.streams.clear();
  }

  // --------------------------------------------------------------------------
  // Pipeline Debugging
  // --------------------------------------------------------------------------

  async debugStage(stage: PipelineStage, defaultCamera?: string): Promise<StageResult> {
    const startTime = performance.now();
    const resourceType = this.getResourceType(stage.name);

    const result: StageResult = {
      stageName: stage.name,
      stageLabel: stage.label || stage.name,
      resourceType,
      timestamp: new Date(),
      latencyMs: 0,
      success: false,
    };

    try {
      switch (resourceType) {
        case "camera":
          await this.debugCameraStage(stage, result);
          break;

        case "vision":
          await this.debugVisionStage(stage, result, defaultCamera);
          break;

        default:
          result.error = `Unknown resource type for ${stage.name}`;
      }

      result.success = !result.error;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    result.latencyMs = Math.round(performance.now() - startTime);
    return result;
  }

  private async debugCameraStage(stage: PipelineStage, result: StageResult): Promise<void> {
    // Try to get 2D image
    try {
      const image = await this.getCameraImage(stage.name);
      result.image = {
        data: image.data,
        mimeType: image.mimeType,
      };
    } catch (imageError) {
      // Camera might only support point clouds
    }

    // Try to get point cloud
    try {
      const pointCloud = await this.getPointCloud(stage.name);
      result.pointCloud = pointCloud;
    } catch (pcError) {
      // Camera might not support point clouds
    }

    // Must have at least one
    if (!result.image && !result.pointCloud) {
      result.error = "Camera returned neither image nor point cloud";
    }
  }

  private async debugVisionStage(
    stage: PipelineStage,
    result: StageResult,
    defaultCamera?: string
  ): Promise<void> {
    const cameraName = stage.sourceCamera || defaultCamera;
    if (!cameraName) {
      result.error = "Vision service requires a source camera";
      return;
    }

    // Get properties to know what's supported
    try {
      const props = await this.getVisionProperties(stage.name);
      result.properties = {
        detectionsSupported: props.detectionsSupported ?? false,
        classificationsSupported: props.classificationsSupported ?? false,
        objectPointCloudsSupported: props.objectPointCloudsSupported ?? false,
      };
    } catch {
      // Properties not available, try everything
      result.properties = {
        detectionsSupported: true,
        classificationsSupported: true,
        objectPointCloudsSupported: true,
      };
    }

    // Get detections
    if (result.properties.detectionsSupported) {
      try {
        result.detections = await this.getDetections(stage.name, cameraName);
      } catch (e) {
        // Detections failed
      }
    }

    // Get classifications
    if (result.properties.classificationsSupported) {
      try {
        result.classifications = await this.getClassifications(stage.name, cameraName);
      } catch {
        // Classifications failed
      }
    }

    // Get 3D objects
    if (result.properties.objectPointCloudsSupported) {
      try {
        const objects = await this.getObjectPointClouds(stage.name, cameraName);
        result.objects = objects.map((obj: any) => ({
          label: obj.geometries?.[0]?.label || "object",
          center: obj.geometries?.[0]?.center || { x: 0, y: 0, z: 0 },
          pointCount: 0,
        }));
      } catch {
        // 3D objects failed
      }
    }
  }

  async debugPipeline(pipeline: Pipeline): Promise<StageResult[]> {
    const results: StageResult[] = [];
    let lastCamera: string | undefined = this.config.defaultCamera;

    for (const stage of pipeline.stages) {
      const result = await this.debugStage(stage, lastCamera);
      results.push(result);

      // Track the last camera for vision services
      if (result.resourceType === "camera") {
        lastCamera = stage.name;
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Auto-refresh
  // --------------------------------------------------------------------------

  startAutoRefresh(callback: (results: Map<string, StageResult[]>) => void, pipelines: Pipeline[]): void {
    if (this.config.refreshInterval && this.config.refreshInterval > 0) {
      this.refreshTimer = window.setInterval(async () => {
        const allResults = new Map<string, StageResult[]>();
        for (const pipeline of pipelines) {
          const results = await this.debugPipeline(pipeline);
          allResults.set(pipeline.id, results);
        }
        callback(allResults);
      }, this.config.refreshInterval);
    }
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

// ============================================================================
// Export singleton factory
// ============================================================================

export function createDebugger(config?: DebuggerConfig): PipelineDebugger {
  return new PipelineDebugger(config);
}
