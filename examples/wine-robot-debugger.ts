/**
 * Wine Robot Pipeline Debugger - Example Application
 * 
 * This example connects to the vino1-main machine and provides
 * a visual debugger for all its camera pipelines.
 * 
 * Usage:
 *   1. Replace API_KEY and API_KEY_ID with your credentials
 *   2. npm install
 *   3. npm run dev
 *   4. Open http://localhost:5173 in your browser
 */

import * as VIAM from '@viamrobotics/sdk';

// ============================================================================
// Configuration - Replace with your credentials
// ============================================================================

const CONFIG = {
  host: 'vino1-main.kssbd6djf3.viam.cloud',
  apiKey: '19z3hz6qrpwaih4btjj1fm6ea5j9b7t6',      // Replace with your API key
  apiKeyId: 'a4b3df8e-6004-43da-90b5-24dcb64dfc9a', // Replace with your API key ID
};

// ============================================================================
// Pipeline Definitions for the Wine Robot
// ============================================================================

interface PipelineStage {
  name: string;
  label: string;
  type: 'camera' | 'vision' | 'vision-3d';
  sourceCamera?: string;
  description?: string;
  pointCloudOnly?: boolean;  // If true, only fetch point cloud, not image
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
}

const PIPELINES: Pipeline[] = [
  {
    id: 'left-arm',
    name: 'Left Arm Glass Detection',
    description: 'Detects glass position for left arm manipulation',
    stages: [
      { 
        name: 'left-cam', 
        label: 'Left RealSense', 
        type: 'camera',
        description: 'Intel RealSense depth camera on left arm'
      },
      { 
        name: 'glass-finder-first-service-left', 
        label: 'Glass Detector (2D)', 
        type: 'vision',
        sourceCamera: 'left-cam',
        description: 'ML model detecting glass from top view'
      },
      { 
        name: 'glass-finder-left-crop', 
        label: 'Detection Crop', 
        type: 'camera',
        description: 'Point cloud cropped to detected glass bbox'
      },
      { 
        name: 'cam-left-cup-crop', 
        label: 'Cup Region', 
        type: 'camera',
        description: '3D bounding box filtered point cloud'
      },
    ]
  },
  {
    id: 'right-arm',
    name: 'Right Arm Glass Detection',
    description: 'Detects glass position for right arm manipulation',
    stages: [
      { 
        name: 'right-cam', 
        label: 'Right RealSense', 
        type: 'camera',
        description: 'Intel RealSense depth camera on right arm'
      },
      { 
        name: 'glass-finder-first-service-right', 
        label: 'Glass Detector (2D)', 
        type: 'vision',
        sourceCamera: 'right-cam',
        description: 'ML model detecting glass from top view'
      },
      { 
        name: 'glass-finder-right-crop', 
        label: 'Detection Crop', 
        type: 'camera',
        description: 'Point cloud cropped to detected glass bbox'
      },
      { 
        name: 'cam-right-cup-crop', 
        label: 'Cup Region', 
        type: 'camera',
        description: '3D bounding box filtered point cloud'
      },
    ]
  },
  {
    id: 'merged-view',
    name: 'Merged Cup View',
    description: 'Combined point clouds from both cameras',
    stages: [
      { 
        name: 'cam-left-cup-crop', 
        label: 'Left Cup Crop', 
        type: 'camera',
        pointCloudOnly: true,
        description: 'Left camera cup region'
      },
      { 
        name: 'cam-right-cup-crop', 
        label: 'Right Cup Crop', 
        type: 'camera',
        pointCloudOnly: true,
        description: 'Right camera cup region'
      },
      { 
        name: 'cam-merged-cup', 
        label: 'Merged Point Cloud', 
        type: 'camera',
        pointCloudOnly: true,
        description: 'Combined point clouds'
      },
      { 
        name: 'cup-finder-segment', 
        label: '3D Segmentation', 
        type: 'vision-3d',
        sourceCamera: 'cam-merged-cup',
        description: 'Obstacle segmentation for cup detection'
      },
    ]
  },
  {
    id: 'pour-position',
    name: 'Pour Position Detection',
    description: 'Detects glass position for pouring',
    stages: [
      { 
        name: 'cam-glass', 
        label: 'Glass Camera', 
        type: 'camera',
        description: 'Webcam viewing pour area'
      },
      { 
        name: 'pour-glass-find-service', 
        label: 'Pour Position Detector', 
        type: 'vision',
        sourceCamera: 'cam-glass',
        description: 'Detects glass for pour alignment'
      },
    ]
  },
  {
    id: 'bottle-detection',
    name: 'Bottle Detection',
    description: 'Right arm bottle region',
    stages: [
      { 
        name: 'right-cam', 
        label: 'Right RealSense', 
        type: 'camera',
        description: 'Intel RealSense depth camera'
      },
      { 
        name: 'cam-right-bottle-crop', 
        label: 'Bottle Region', 
        type: 'camera',
        description: 'Point cloud cropped to bottle area'
      },
    ]
  },
];

// ============================================================================
// Types
// ============================================================================

interface Detection {
  className: string;
  confidence: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface PointCloudStats {
  pointCount: number;
  boundingBox: { min: Point3D; max: Point3D };
  dimensions: Point3D;           // size in each axis (mm)
  volume: number;                // bounding box volume (mm³)
  pointDensity: number;          // points per mm³
  coverage: number;              // estimated coverage percentage (0-100)
  hasNormals: boolean;
  normalQuality?: {
    validCount: number;          // points with valid normals
    validPercent: number;        // percentage with valid normals
    consistency: number;         // 0-1 score of normal consistency in local neighborhoods
  };
}

interface PointCloudData {
  points: Point3D[];
  normals?: Point3D[];
  boundingBox: { min: Point3D; max: Point3D };
  stats?: PointCloudStats;
}

interface Object3D {
  label: string;
  center: Point3D;
  dimensions?: Point3D;
  pointCloud?: PointCloudData;  // The segmented point cloud for this object
}

interface DetectionStats {
  count: number;
  found: boolean;                // at least one detection
  maxConfidence: number;
  avgConfidence: number;
  classes: string[];             // unique classes detected
}

interface StageResult {
  stageName: string;
  label: string;
  type: string;
  success: boolean;
  latencyMs: number;
  error?: string;
  image?: { data: Uint8Array; mimeType: string };
  pointCloud?: PointCloudData;
  detections?: Detection[];
  detectionStats?: DetectionStats;
  objects3d?: Object3D[];
  segmentedPointCloud?: PointCloudData;  // Combined point cloud from all segmented objects
}

// History tracking for trends
interface StageHistory {
  timestamps: number[];
  latencies: number[];
  successes: boolean[];
  detectionCounts: number[];
  confidences: number[];         // max confidence per sample
  pointCounts: number[];
}

const stageHistories = new Map<string, StageHistory>();
const MAX_HISTORY = 50;

// ============================================================================
// PCD Parser
// ============================================================================

function parsePCD(data: Uint8Array): PointCloudData {
  // Find header end by looking for DATA line
  let headerEnd = 0;
  for (let i = 0; i < Math.min(data.length, 2000); i++) {
    // Look for "DATA " pattern
    if (data[i] === 68 && data[i+1] === 65 && data[i+2] === 84 && data[i+3] === 65 && data[i+4] === 32) {
      // Find the newline after DATA
      for (let j = i + 5; j < data.length; j++) {
        if (data[j] === 10) { // newline
          headerEnd = j + 1;
          break;
        }
      }
      break;
    }
  }
  
  const headerText = new TextDecoder().decode(data.slice(0, headerEnd));
  const headerLines = headerText.split('\n');
  
  let fields: string[] = [];
  let sizes: number[] = [];
  let types: string[] = [];
  let pointCount = 0;
  let dataFormat = 'ascii';
  
  for (const line of headerLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('FIELDS')) fields = trimmed.split(/\s+/).slice(1);
    else if (trimmed.startsWith('SIZE')) sizes = trimmed.split(/\s+/).slice(1).map(Number);
    else if (trimmed.startsWith('TYPE')) types = trimmed.split(/\s+/).slice(1);
    else if (trimmed.startsWith('WIDTH')) pointCount = parseInt(trimmed.split(/\s+/)[1], 10);
    else if (trimmed.startsWith('POINTS')) pointCount = parseInt(trimmed.split(/\s+/)[1], 10);
    else if (trimmed.startsWith('DATA')) dataFormat = trimmed.split(/\s+/)[1]?.toLowerCase() || 'ascii';
  }
  
  const points: Point3D[] = [];
  const normals: Point3D[] = [];
  
  const xi = fields.indexOf('x');
  const yi = fields.indexOf('y');
  const zi = fields.indexOf('z');
  const nxi = fields.includes('normal_x') ? fields.indexOf('normal_x') : fields.indexOf('nx');
  const nyi = fields.includes('normal_y') ? fields.indexOf('normal_y') : fields.indexOf('ny');
  const nzi = fields.includes('normal_z') ? fields.indexOf('normal_z') : fields.indexOf('nz');
  
  if (dataFormat === 'binary') {
    // Calculate stride (bytes per point)
    const stride = sizes.reduce((a, b) => a + b, 0);
    const dataView = new DataView(data.buffer, data.byteOffset + headerEnd);
    
    // Calculate field offsets
    const offsets: number[] = [];
    let offset = 0;
    for (const size of sizes) {
      offsets.push(offset);
      offset += size;
    }
    
    for (let i = 0; i < pointCount && (headerEnd + i * stride + stride) <= data.length; i++) {
      const baseOffset = i * stride;
      
      // Read x, y, z as floats
      const x = dataView.getFloat32(baseOffset + offsets[xi], true);
      const y = dataView.getFloat32(baseOffset + offsets[yi], true);
      const z = dataView.getFloat32(baseOffset + offsets[zi], true);
      
      if (!isNaN(x) && !isNaN(y) && !isNaN(z) && isFinite(x) && isFinite(y) && isFinite(z)) {
        points.push({ x, y, z });
        
        if (nxi >= 0 && offsets[nxi] !== undefined) {
          normals.push({
            x: dataView.getFloat32(baseOffset + offsets[nxi], true),
            y: dataView.getFloat32(baseOffset + offsets[nyi], true),
            z: dataView.getFloat32(baseOffset + offsets[nzi], true),
          });
        }
      }
    }
  } else {
    // ASCII format
    const text = new TextDecoder().decode(data);
    const lines = text.split('\n');
    let dataStart = 0;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('DATA')) {
        dataStart = i + 1;
        break;
      }
    }
    
    for (let i = dataStart; i < lines.length && points.length < pointCount; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length >= 3) {
        const x = parseFloat(parts[xi >= 0 ? xi : 0]);
        const y = parseFloat(parts[yi >= 0 ? yi : 1]);
        const z = parseFloat(parts[zi >= 0 ? zi : 2]);
        
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          points.push({ x, y, z });
          if (nxi >= 0 && parts[nxi]) {
            normals.push({
              x: parseFloat(parts[nxi]),
              y: parseFloat(parts[nyi]),
              z: parseFloat(parts[nzi]),
            });
          }
        }
      }
    }
  }
  
  console.log(`    PCD: ${dataFormat} format, ${pointCount} expected, ${points.length} parsed`);
  
  // Calculate bounding box
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
  
  return {
    points,
    normals: normals.length > 0 ? normals : undefined,
    boundingBox: { min, max },
    stats: computePointCloudStats(points, normals.length > 0 ? normals : undefined, { min, max }),
  };
}

// ============================================================================
// Point Cloud Statistics
// ============================================================================

function computePointCloudStats(
  points: Point3D[], 
  normals: Point3D[] | undefined, 
  boundingBox: { min: Point3D; max: Point3D }
): PointCloudStats {
  const dimensions = {
    x: boundingBox.max.x - boundingBox.min.x,
    y: boundingBox.max.y - boundingBox.min.y,
    z: boundingBox.max.z - boundingBox.min.z,
  };
  
  const volume = dimensions.x * dimensions.y * dimensions.z;
  const pointCount = points.length;
  const pointDensity = volume > 0 ? pointCount / volume : 0;
  
  // Estimate coverage using voxel grid
  const coverage = estimateCoverage(points, boundingBox, dimensions);
  
  // Normal quality analysis
  let normalQuality: PointCloudStats['normalQuality'] = undefined;
  if (normals && normals.length > 0) {
    normalQuality = analyzeNormalQuality(points, normals);
  }
  
  return {
    pointCount,
    boundingBox,
    dimensions,
    volume,
    pointDensity,
    coverage,
    hasNormals: !!normals && normals.length > 0,
    normalQuality,
  };
}

function estimateCoverage(
  points: Point3D[], 
  boundingBox: { min: Point3D; max: Point3D },
  dimensions: Point3D
): number {
  // Use a voxel grid to estimate coverage
  // Target ~20 voxels per axis for reasonable granularity
  const voxelsPerAxis = 20;
  const voxelSize = {
    x: dimensions.x / voxelsPerAxis || 1,
    y: dimensions.y / voxelsPerAxis || 1,
    z: dimensions.z / voxelsPerAxis || 1,
  };
  
  const occupiedVoxels = new Set<string>();
  
  for (const p of points) {
    const vx = Math.floor((p.x - boundingBox.min.x) / voxelSize.x);
    const vy = Math.floor((p.y - boundingBox.min.y) / voxelSize.y);
    const vz = Math.floor((p.z - boundingBox.min.z) / voxelSize.z);
    occupiedVoxels.add(`${vx},${vy},${vz}`);
  }
  
  const totalVoxels = voxelsPerAxis * voxelsPerAxis * voxelsPerAxis;
  return (occupiedVoxels.size / totalVoxels) * 100;
}

function analyzeNormalQuality(points: Point3D[], normals: Point3D[]): PointCloudStats['normalQuality'] {
  let validCount = 0;
  
  // Check for valid normals (non-zero, unit length)
  for (const n of normals) {
    const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (len > 0.9 && len < 1.1) {  // approximately unit length
      validCount++;
    }
  }
  
  const validPercent = normals.length > 0 ? (validCount / normals.length) * 100 : 0;
  
  // Compute consistency by checking local neighborhoods
  // Sample a subset of points for performance
  const sampleSize = Math.min(500, points.length);
  const step = Math.max(1, Math.floor(points.length / sampleSize));
  
  let consistentCount = 0;
  let comparisonCount = 0;
  
  // For sampled points, find nearby points and compare normals
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const n = normals[i];
    if (!n) continue;
    
    // Find nearby points (simple distance check)
    const neighborRadius = 10; // mm - adjust based on your scale
    let neighborNormals: Point3D[] = [];
    
    for (let j = Math.max(0, i - 50); j < Math.min(points.length, i + 50); j++) {
      if (i === j || !normals[j]) continue;
      const pj = points[j];
      const dist = Math.sqrt(
        (p.x - pj.x) ** 2 + 
        (p.y - pj.y) ** 2 + 
        (p.z - pj.z) ** 2
      );
      if (dist < neighborRadius) {
        neighborNormals.push(normals[j]);
      }
    }
    
    // Check if normal is consistent with neighbors (dot product > 0.8)
    for (const nn of neighborNormals) {
      const dot = n.x * nn.x + n.y * nn.y + n.z * nn.z;
      comparisonCount++;
      if (Math.abs(dot) > 0.8) {  // abs because normals could be flipped
        consistentCount++;
      }
    }
  }
  
  const consistency = comparisonCount > 0 ? consistentCount / comparisonCount : 1;
  
  return {
    validCount,
    validPercent,
    consistency,
  };
}

// ============================================================================
// Detection Statistics
// ============================================================================

function computeDetectionStats(detections: Detection[]): DetectionStats {
  const count = detections.length;
  const found = count > 0;
  
  let maxConfidence = 0;
  let sumConfidence = 0;
  const classSet = new Set<string>();
  
  for (const d of detections) {
    maxConfidence = Math.max(maxConfidence, d.confidence);
    sumConfidence += d.confidence;
    classSet.add(d.className);
  }
  
  return {
    count,
    found,
    maxConfidence,
    avgConfidence: count > 0 ? sumConfidence / count : 0,
    classes: Array.from(classSet),
  };
}

// ============================================================================
// History Tracking
// ============================================================================

function updateHistory(stageName: string, result: StageResult): void {
  let history = stageHistories.get(stageName);
  
  if (!history) {
    history = {
      timestamps: [],
      latencies: [],
      successes: [],
      detectionCounts: [],
      confidences: [],
      pointCounts: [],
    };
    stageHistories.set(stageName, history);
  }
  
  history.timestamps.push(Date.now());
  history.latencies.push(result.latencyMs);
  history.successes.push(result.success);
  history.detectionCounts.push(result.detections?.length ?? 0);
  history.confidences.push(result.detectionStats?.maxConfidence ?? 0);
  history.pointCounts.push(result.pointCloud?.points.length ?? 0);
  
  // Trim to max history
  if (history.timestamps.length > MAX_HISTORY) {
    history.timestamps.shift();
    history.latencies.shift();
    history.successes.shift();
    history.detectionCounts.shift();
    history.confidences.shift();
    history.pointCounts.shift();
  }
}

function getHistoryStats(stageName: string): {
  avgLatency: number;
  successRate: number;
  latencyTrend: 'stable' | 'increasing' | 'decreasing';
  detectionRate: number;
  avgConfidence: number;
} | null {
  const history = stageHistories.get(stageName);
  if (!history || history.timestamps.length < 2) return null;
  
  const avgLatency = history.latencies.reduce((a, b) => a + b, 0) / history.latencies.length;
  const successRate = history.successes.filter(Boolean).length / history.successes.length * 100;
  const detectionRate = history.detectionCounts.filter(c => c > 0).length / history.detectionCounts.length * 100;
  const avgConfidence = history.confidences.filter(c => c > 0).reduce((a, b) => a + b, 0) / 
                        (history.confidences.filter(c => c > 0).length || 1);
  
  // Compute latency trend (compare first half to second half)
  const mid = Math.floor(history.latencies.length / 2);
  const firstHalf = history.latencies.slice(0, mid);
  const secondHalf = history.latencies.slice(mid);
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  
  let latencyTrend: 'stable' | 'increasing' | 'decreasing' = 'stable';
  if (secondAvg > firstAvg * 1.2) latencyTrend = 'increasing';
  else if (secondAvg < firstAvg * 0.8) latencyTrend = 'decreasing';
  
  return { avgLatency, successRate, latencyTrend, detectionRate, avgConfidence };
}

// ============================================================================
// Wine Robot Debugger Class
// ============================================================================

class WineRobotDebugger {
  private machine: VIAM.RobotClient | null = null;
  
  async connect(): Promise<void> {
    console.log(`Connecting to ${CONFIG.host}...`);
    
    this.machine = await VIAM.createRobotClient({
      host: CONFIG.host,
      credentials: {
        type: 'api-key',
        payload: CONFIG.apiKey,
        authEntity: CONFIG.apiKeyId,
      },
      signalingAddress: 'https://app.viam.com:443',
    });
    
    console.log('Connected!');
    
    // List all resources
    const resources = await this.machine.resourceNames();
    console.log('Available resources:', resources.map(r => `${r.subtype}/${r.name}`));
  }
  
  async disconnect(): Promise<void> {
    if (this.machine) {
      await this.machine.disconnect();
      this.machine = null;
    }
  }
  
  async getCameraImage(name: string): Promise<{ data: Uint8Array; mimeType: string }> {
    if (!this.machine) throw new Error('Not connected');
    const camera = new VIAM.CameraClient(this.machine, name);
    const data = await camera.getImage('image/jpeg');
    return { data, mimeType: 'image/jpeg' };
  }
  
  async getPointCloud(name: string): Promise<PointCloudData> {
    if (!this.machine) throw new Error('Not connected');
    const camera = new VIAM.CameraClient(this.machine, name);
    const result = await camera.getPointCloud();
    return parsePCD(result.data);
  }
  
  async getDetections(visionName: string, cameraName: string): Promise<Detection[]> {
    if (!this.machine) throw new Error('Not connected');
    const vision = new VIAM.VisionClient(this.machine, visionName);
    const detections = await vision.getDetectionsFromCamera(cameraName);
    return detections.map(d => ({
      className: d.className ?? 'unknown',
      confidence: d.confidence ?? 0,
      xMin: d.xMin ?? 0,
      yMin: d.yMin ?? 0,
      xMax: d.xMax ?? 0,
      yMax: d.yMax ?? 0,
    }));
  }
  
  async getObjectPointClouds(visionName: string, cameraName: string): Promise<{ objects: Object3D[], combinedPointCloud?: PointCloudData }> {
    if (!this.machine) throw new Error('Not connected');
    const vision = new VIAM.VisionClient(this.machine, visionName);
    const rawObjects = await vision.getObjectPointClouds(cameraName);
    
    console.log(`  [${visionName}] Got ${rawObjects.length} segmented objects`);
    
    // Collect all points from all objects for combined stats
    const allPoints: Point3D[] = [];
    const allNormals: Point3D[] = [];
    
    const objects: Object3D[] = rawObjects.map((obj: any, i: number) => {
      // Extract geometry info if available
      const geo = obj.geometries?.geometries?.[0];
      
      // Parse point cloud data - it's directly a Uint8Array, not obj.pointCloud.data
      let pointCloud: PointCloudData | undefined;
      if (obj.pointCloud instanceof Uint8Array && obj.pointCloud.length > 0) {
        try {
          pointCloud = parsePCD(obj.pointCloud);
          console.log(`    Object ${i}: ${pointCloud.points.length} points`);
          
          // Add to combined
          allPoints.push(...pointCloud.points);
          if (pointCloud.normals) {
            allNormals.push(...pointCloud.normals);
          }
        } catch (e) {
          console.log(`    Object ${i}: Failed to parse PCD`, e);
        }
      } else {
        console.log(`    Object ${i}: No point cloud data`);
      }
      
      return {
        label: geo?.label || `object-${i}`,
        center: geo?.center || { x: 0, y: 0, z: 0 },
        dimensions: geo?.box ? {
          x: geo.box.dimsMm?.x || 0,
          y: geo.box.dimsMm?.y || 0,
          z: geo.box.dimsMm?.z || 0,
        } : undefined,
        pointCloud,
      };
    });
    
    // Compute combined point cloud stats
    let combinedPointCloud: PointCloudData | undefined;
    if (allPoints.length > 0) {
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      
      for (const p of allPoints) {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
      }
      
      combinedPointCloud = {
        points: allPoints,
        normals: allNormals.length > 0 ? allNormals : undefined,
        boundingBox: { min, max },
        stats: computePointCloudStats(allPoints, allNormals.length > 0 ? allNormals : undefined, { min, max }),
      };
      
      console.log(`  [${visionName}] Combined: ${allPoints.length} total points`);
    }
    
    return { objects, combinedPointCloud };
  }
  
  async debugStage(stage: PipelineStage): Promise<StageResult> {
    const start = performance.now();
    const result: StageResult = {
      stageName: stage.name,
      label: stage.label,
      type: stage.type,
      success: false,
      latencyMs: 0,
    };
    
    try {
      if (stage.type === 'camera') {
        if (stage.pointCloudOnly) {
          // Fetch both image and point cloud for these stages
          try {
            result.image = await this.getCameraImage(stage.name);
            console.log(`  [${stage.name}] Got image: ${result.image.data.length} bytes`);
          } catch (e) {
            console.log(`  [${stage.name}] No image:`, e);
          }
          try {
            console.log(`  [${stage.name}] Fetching point cloud...`);
            result.pointCloud = await this.getPointCloud(stage.name);
            console.log(`  [${stage.name}] Got point cloud: ${result.pointCloud.points.length} points`);
          } catch (e) {
            console.log(`  [${stage.name}] Point cloud error:`, e);
          }
        } else {
          // Fetch image only for regular cameras
          try {
            result.image = await this.getCameraImage(stage.name);
            console.log(`  [${stage.name}] Got image: ${result.image.data.length} bytes`);
          } catch (e) {
            console.log(`  [${stage.name}] No image:`, e);
          }
        }
        
        result.success = !!(result.image || result.pointCloud);
        if (!result.success) {
          result.error = stage.pointCloudOnly ? 'Camera returned no point cloud' : 'Camera returned no image';
        }
      } else if (stage.type === 'vision' && stage.sourceCamera) {
        result.detections = await this.getDetections(stage.name, stage.sourceCamera);
        result.success = true;
      } else if (stage.type === 'vision-3d' && stage.sourceCamera) {
        const { objects, combinedPointCloud } = await this.getObjectPointClouds(stage.name, stage.sourceCamera);
        result.objects3d = objects;
        result.segmentedPointCloud = combinedPointCloud;
        result.success = true;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    
    result.latencyMs = Math.round(performance.now() - start);
    
    // Compute detection stats if we have detections
    if (result.detections) {
      result.detectionStats = computeDetectionStats(result.detections);
    }
    
    // Update history for trend tracking
    updateHistory(stage.name, result);
    
    return result;
  }
  
  async debugPipeline(pipeline: Pipeline): Promise<StageResult[]> {
    console.log(`\nDebugging pipeline: ${pipeline.name}`);
    console.log(pipeline.description);
    console.log('─'.repeat(50));
    
    const results: StageResult[] = [];
    
    for (const stage of pipeline.stages) {
      const result = await this.debugStage(stage);
      results.push(result);
      
      const status = result.success ? '✓' : '✗';
      const latency = `${result.latencyMs}ms`;
      
      console.log(`${status} ${stage.label} (${stage.name}): ${latency}`);
      
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      if (result.image) {
        console.log(`  Image: ${result.image.data.length} bytes`);
      }
      if (result.pointCloud) {
        console.log(`  Point cloud: ${result.pointCloud.points.length} points`);
        if (result.pointCloud.normals) {
          console.log(`  Has normal vectors`);
        }
      }
      if (result.detections) {
        console.log(`  Detections: ${result.detections.length}`);
        result.detections.forEach(d => {
          console.log(`    - ${d.className}: ${(d.confidence * 100).toFixed(1)}%`);
        });
      }
    }
    
    return results;
  }
  
  async debugAllPipelines(): Promise<Map<string, StageResult[]>> {
    const allResults = new Map<string, StageResult[]>();
    
    for (const pipeline of PIPELINES) {
      const results = await this.debugPipeline(pipeline);
      allResults.set(pipeline.id, results);
    }
    
    return allResults;
  }
}

// ============================================================================
// UI Rendering
// ============================================================================

function createUI(): void {
  document.body.innerHTML = `
    <style>
      :root {
        --bg: #0a0a0f;
        --panel: #12121a;
        --border: #2a2a3a;
        --text: #e8e8ec;
        --muted: #888;
        --accent: #00d4aa;
        --success: #22c55e;
        --warning: #f59e0b;
        --error: #ef4444;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
      h1 { font-size: 24px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
      h1::before { content: '🍷'; }
      h2 { font-size: 16px; color: var(--accent); margin-bottom: 12px; }
      .controls { display: flex; gap: 10px; margin-bottom: 20px; }
      button { padding: 10px 20px; background: var(--accent); color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
      button:hover { opacity: 0.9; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      button.secondary { background: var(--panel); color: var(--text); border: 1px solid var(--border); }
      .status { padding: 8px 16px; border-radius: 6px; font-size: 14px; }
      .status.connected { background: rgba(34,197,94,0.2); color: var(--success); }
      .status.disconnected { background: var(--panel); color: var(--muted); }
      .status.error { background: rgba(239,68,68,0.2); color: var(--error); }
      .pipelines { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 20px; }
      .pipeline { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
      .pipeline-desc { font-size: 12px; color: var(--muted); margin-bottom: 16px; }
      .stage { background: rgba(0,0,0,0.3); border-radius: 6px; padding: 12px; margin-bottom: 10px; border-left: 3px solid var(--border); }
      .stage.success { border-left-color: var(--success); }
      .stage.error { border-left-color: var(--error); }
      .stage-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .stage-name { font-weight: 500; }
      .stage-meta { font-size: 11px; color: var(--muted); }
      .stage-type { background: var(--border); padding: 2px 6px; border-radius: 3px; margin-right: 8px; }
      .latency { color: var(--accent); }
      .stage-desc { font-size: 11px; color: var(--muted); margin-bottom: 8px; }
      .stage-content { margin-top: 10px; }
      .stage-content canvas { width: 100%; max-height: 200px; background: #000; border-radius: 4px; }
      .stage-content img { width: 100%; max-height: 200px; object-fit: contain; background: #000; border-radius: 4px; }
      .detections { font-family: monospace; font-size: 12px; }
      .detection { display: flex; justify-content: space-between; padding: 4px 8px; background: rgba(0,212,170,0.1); border-radius: 3px; margin-bottom: 4px; }
      .error-msg { color: var(--error); font-size: 12px; padding: 8px; background: rgba(239,68,68,0.1); border-radius: 4px; }
      .no-data { color: var(--muted); font-size: 12px; text-align: center; padding: 20px; }
      .flow-arrow { text-align: center; color: var(--muted); font-size: 16px; margin: 4px 0; }
      .pc-info { font-size: 10px; color: var(--muted); margin-top: 4px; font-family: monospace; }
      
      /* Stats styles */
      .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 8px; font-size: 10px; font-family: monospace; }
      .stat { background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px; }
      .stat-label { color: var(--muted); display: block; margin-bottom: 2px; }
      .stat-value { color: var(--text); font-weight: 500; }
      .stat-value.good { color: var(--success); }
      .stat-value.warn { color: var(--warning); }
      .stat-value.bad { color: var(--error); }
      .stat-bar { height: 3px; background: var(--border); border-radius: 2px; margin-top: 3px; overflow: hidden; }
      .stat-bar-fill { height: 100%; background: var(--accent); }
      .stat-bar-fill.good { background: var(--success); }
      .stat-bar-fill.warn { background: var(--warning); }
      .stat-bar-fill.bad { background: var(--error); }
      
      /* Detection indicator */
      .detection-indicator { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; margin-top: 6px; }
      .detection-indicator .dot { width: 8px; height: 8px; border-radius: 50%; }
      .detection-indicator .dot.found { background: var(--success); box-shadow: 0 0 6px var(--success); }
      .detection-indicator .dot.not-found { background: var(--error); }
      
      /* History stats */
      .history-stats { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px; color: var(--muted); }
      .history-stats span { margin-right: 10px; }
      .trend-up { color: var(--error); }
      .trend-down { color: var(--success); }
      .trend-stable { color: var(--muted); }
    </style>
    
    <h1>Wine Robot Pipeline Debugger</h1>
    
    <div class="controls">
      <button id="connectBtn">Connect</button>
      <button id="refreshBtn" disabled>Refresh All</button>
      <button id="autoBtn" class="secondary" disabled>Auto-Refresh (Off)</button>
      <span id="status" class="status disconnected">Disconnected</span>
    </div>
    
    <div id="pipelines" class="pipelines">
      ${PIPELINES.map(p => `
        <div class="pipeline" id="pipeline-${p.id}">
          <h2>${p.name}</h2>
          <div class="pipeline-desc">${p.description}</div>
          <div class="stages">
            ${p.stages.map((s, i) => `
              <div class="stage" id="stage-${p.id}-${s.name}">
                <div class="stage-header">
                  <span class="stage-name">${s.label}</span>
                  <span class="stage-meta">
                    <span class="stage-type">${s.type}</span>
                    <span class="latency" id="latency-${p.id}-${s.name}">--</span>
                  </span>
                </div>
                <div class="stage-desc">${s.description || s.name}</div>
                <div class="stage-content" id="content-${p.id}-${s.name}">
                  <div class="no-data">Click Connect then Refresh</div>
                </div>
              </div>
              ${i < p.stages.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function updateStageUI(pipelineId: string, result: StageResult): void {
  const stageEl = document.getElementById(`stage-${pipelineId}-${result.stageName}`);
  const latencyEl = document.getElementById(`latency-${pipelineId}-${result.stageName}`);
  const contentEl = document.getElementById(`content-${pipelineId}-${result.stageName}`);
  
  if (!stageEl || !latencyEl || !contentEl) return;
  
  // Update status
  stageEl.classList.remove('success', 'error');
  stageEl.classList.add(result.success ? 'success' : 'error');
  
  // Update latency
  latencyEl.textContent = `${result.latencyMs}ms`;
  
  // Update content
  if (result.error) {
    contentEl.innerHTML = `<div class="error-msg">${result.error}</div>`;
  } else if (result.image) {
    const blob = new Blob([result.image.data], { type: result.image.mimeType });
    const url = URL.createObjectURL(blob);
    contentEl.innerHTML = `<img src="${url}" alt="${result.stageName}">`;
    
    // Draw detections if present
    if (result.detections && result.detections.length > 0) {
      const img = contentEl.querySelector('img')!;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        
        ctx.lineWidth = 2;
        ctx.font = '14px monospace';
        
        result.detections!.forEach((d, i) => {
          const hue = (i * 137.5) % 360;
          ctx.strokeStyle = `hsl(${hue}, 80%, 50%)`;
          ctx.strokeRect(d.xMin, d.yMin, d.xMax - d.xMin, d.yMax - d.yMin);
          
          const label = `${d.className} ${(d.confidence * 100).toFixed(0)}%`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = `hsla(${hue}, 80%, 20%, 0.8)`;
          ctx.fillRect(d.xMin, d.yMin - 20, tw + 8, 20);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, d.xMin + 4, d.yMin - 5);
        });
        
        contentEl.innerHTML = '';
        canvas.style.cssText = 'width:100%;max-height:200px;background:#000;border-radius:4px;';
        contentEl.appendChild(canvas);
        
        // Add point cloud stats below if available
        if (result.pointCloud?.stats) {
          appendPointCloudStats(contentEl, result.pointCloud);
        }
      };
    } else {
      // No detections - add point cloud stats if available
      if (result.pointCloud?.stats) {
        appendPointCloudStats(contentEl, result.pointCloud);
      }
    }
  } else if (result.pointCloud) {
    const pc = result.pointCloud;
    const stats = pc.stats;
    const size = {
      x: (pc.boundingBox.max.x - pc.boundingBox.min.x).toFixed(0),
      y: (pc.boundingBox.max.y - pc.boundingBox.min.y).toFixed(0),
      z: (pc.boundingBox.max.z - pc.boundingBox.min.z).toFixed(0),
    };
    
    // Determine quality indicators
    const densityClass = stats && stats.pointDensity > 0.001 ? 'good' : stats && stats.pointDensity > 0.0001 ? 'warn' : 'bad';
    const coverageClass = stats && stats.coverage > 10 ? 'good' : stats && stats.coverage > 5 ? 'warn' : 'bad';
    const normalClass = stats?.normalQuality ? 
      (stats.normalQuality.consistency > 0.8 ? 'good' : stats.normalQuality.consistency > 0.5 ? 'warn' : 'bad') : '';
    
    contentEl.innerHTML = `
      <div style="background:#111;border-radius:4px;padding:12px;">
        <div style="text-align:center;margin-bottom:8px;">
          <strong>${pc.points.length.toLocaleString()}</strong> points
          <span style="color:var(--muted);margin-left:8px;">${size.x}×${size.y}×${size.z} mm</span>
        </div>
        ${stats ? `
          <div class="stats-grid">
            <div class="stat">
              <span class="stat-label">Density</span>
              <span class="stat-value ${densityClass}">${(stats.pointDensity * 1000).toFixed(3)} pts/mm³</span>
            </div>
            <div class="stat">
              <span class="stat-label">Coverage</span>
              <span class="stat-value ${coverageClass}">${stats.coverage.toFixed(1)}%</span>
              <div class="stat-bar"><div class="stat-bar-fill ${coverageClass}" style="width:${Math.min(100, stats.coverage)}%"></div></div>
            </div>
            ${stats.normalQuality ? `
              <div class="stat">
                <span class="stat-label">Valid Normals</span>
                <span class="stat-value">${stats.normalQuality.validPercent.toFixed(0)}%</span>
                <div class="stat-bar"><div class="stat-bar-fill" style="width:${stats.normalQuality.validPercent}%"></div></div>
              </div>
              <div class="stat">
                <span class="stat-label">Normal Consistency</span>
                <span class="stat-value ${normalClass}">${(stats.normalQuality.consistency * 100).toFixed(0)}%</span>
                <div class="stat-bar"><div class="stat-bar-fill ${normalClass}" style="width:${stats.normalQuality.consistency * 100}%"></div></div>
              </div>
            ` : `
              <div class="stat" style="grid-column: span 2;">
                <span class="stat-label">Normals</span>
                <span class="stat-value bad">Not available</span>
              </div>
            `}
          </div>
        ` : ''}
      </div>
    `;
    
    // Add history stats if available
    appendHistoryStats(contentEl, result.stageName);
    
  } else if (result.detections) {
    const stats = result.detectionStats;
    
    contentEl.innerHTML = `
      <div class="detection-indicator">
        <span class="dot ${stats?.found ? 'found' : 'not-found'}"></span>
        <span>${stats?.found ? `Glass found` : 'No glass detected'}</span>
        ${stats?.found ? `<span style="color:var(--accent);margin-left:auto;">${(stats.maxConfidence * 100).toFixed(0)}% conf</span>` : ''}
      </div>
      ${result.detections.length > 0 ? `
        <div class="detections" style="margin-top:8px;">
          ${result.detections.map(d => `
            <div class="detection">
              <span>${d.className}</span>
              <span>${(d.confidence * 100).toFixed(1)}%</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;
    
    // Add history stats if available
    appendHistoryStats(contentEl, result.stageName);
    
  } else if (result.objects3d) {
    if (result.objects3d.length === 0) {
      contentEl.innerHTML = `<div class="no-data">No 3D objects segmented</div>`;
    } else {
      contentEl.innerHTML = `
        <div class="detections">
          ${result.objects3d.map(obj => `
            <div class="detection" style="flex-direction:column;align-items:flex-start;gap:4px;">
              <span style="font-weight:500;">${obj.label}</span>
              <span style="font-size:10px;color:#888;">
                Center: (${obj.center.x.toFixed(0)}, ${obj.center.y.toFixed(0)}, ${obj.center.z.toFixed(0)}) mm
                ${obj.dimensions ? `<br>Size: ${obj.dimensions.x.toFixed(0)}×${obj.dimensions.y.toFixed(0)}×${obj.dimensions.z.toFixed(0)} mm` : ''}
                ${obj.pointCloud ? `<br>Points: ${obj.pointCloud.points.length.toLocaleString()}` : ''}
              </span>
            </div>
          `).join('')}
        </div>
      `;
      
      // Add combined point cloud stats if available
      if (result.segmentedPointCloud) {
        appendPointCloudStats(contentEl, result.segmentedPointCloud);
      }
    }
  }
}

function appendHistoryStats(contentEl: HTMLElement, stageName: string): void {
  const historyStats = getHistoryStats(stageName);
  if (historyStats) {
    const trendIcon = historyStats.latencyTrend === 'increasing' ? '↑' : 
                      historyStats.latencyTrend === 'decreasing' ? '↓' : '→';
    const trendClass = historyStats.latencyTrend === 'increasing' ? 'trend-up' : 
                       historyStats.latencyTrend === 'decreasing' ? 'trend-down' : 'trend-stable';
    
    const historyDiv = document.createElement('div');
    historyDiv.className = 'history-stats';
    historyDiv.innerHTML = `
      <span>Avg: ${historyStats.avgLatency.toFixed(0)}ms</span>
      <span class="${trendClass}">Trend: ${trendIcon}</span>
      <span>Success: ${historyStats.successRate.toFixed(0)}%</span>
      ${historyStats.detectionRate > 0 ? `<span>Det: ${historyStats.detectionRate.toFixed(0)}%</span>` : ''}
    `;
    contentEl.appendChild(historyDiv);
  }
}

function appendPointCloudStats(contentEl: HTMLElement, pc: PointCloudData): void {
  const stats = pc.stats;
  if (!stats) return;
  
  const size = {
    x: (pc.boundingBox.max.x - pc.boundingBox.min.x).toFixed(0),
    y: (pc.boundingBox.max.y - pc.boundingBox.min.y).toFixed(0),
    z: (pc.boundingBox.max.z - pc.boundingBox.min.z).toFixed(0),
  };
  
  const densityClass = stats.pointDensity > 0.001 ? 'good' : stats.pointDensity > 0.0001 ? 'warn' : 'bad';
  const coverageClass = stats.coverage > 10 ? 'good' : stats.coverage > 5 ? 'warn' : 'bad';
  const normalClass = stats.normalQuality ? 
    (stats.normalQuality.consistency > 0.8 ? 'good' : stats.normalQuality.consistency > 0.5 ? 'warn' : 'bad') : '';
  
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'background:#111;border-radius:4px;padding:12px;margin-top:8px;';
  statsDiv.innerHTML = `
    <div style="text-align:center;margin-bottom:8px;font-size:12px;">
      <strong>${pc.points.length.toLocaleString()}</strong> points
      <span style="color:var(--muted);margin-left:8px;">${size.x}×${size.y}×${size.z} mm</span>
    </div>
    <div class="stats-grid">
      <div class="stat">
        <span class="stat-label">Density</span>
        <span class="stat-value ${densityClass}">${(stats.pointDensity * 1000).toFixed(3)} pts/mm³</span>
      </div>
      <div class="stat">
        <span class="stat-label">Coverage</span>
        <span class="stat-value ${coverageClass}">${stats.coverage.toFixed(1)}%</span>
        <div class="stat-bar"><div class="stat-bar-fill ${coverageClass}" style="width:${Math.min(100, stats.coverage)}%"></div></div>
      </div>
      ${stats.normalQuality ? `
        <div class="stat">
          <span class="stat-label">Valid Normals</span>
          <span class="stat-value">${stats.normalQuality.validPercent.toFixed(0)}%</span>
          <div class="stat-bar"><div class="stat-bar-fill" style="width:${stats.normalQuality.validPercent}%"></div></div>
        </div>
        <div class="stat">
          <span class="stat-label">Normal Consistency</span>
          <span class="stat-value ${normalClass}">${(stats.normalQuality.consistency * 100).toFixed(0)}%</span>
          <div class="stat-bar"><div class="stat-bar-fill ${normalClass}" style="width:${stats.normalQuality.consistency * 100}%"></div></div>
        </div>
      ` : `
        <div class="stat" style="grid-column: span 2;">
          <span class="stat-label">Normals</span>
          <span class="stat-value bad">Not available</span>
        </div>
      `}
    </div>
  `;
  contentEl.appendChild(statsDiv);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  createUI();
  
  const debugger_ = new WineRobotDebugger();
  let autoRefreshInterval: number | null = null;
  
  const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
  const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
  const autoBtn = document.getElementById('autoBtn') as HTMLButtonElement;
  const statusEl = document.getElementById('status')!;
  
  const setStatus = (status: 'connected' | 'disconnected' | 'error', msg?: string) => {
    statusEl.className = `status ${status}`;
    statusEl.textContent = status === 'connected' ? 'Connected' : 
                           status === 'error' ? `Error: ${msg}` : 'Disconnected';
  };
  
  const refreshAll = async () => {
    for (const pipeline of PIPELINES) {
      for (const stage of pipeline.stages) {
        const result = await debugger_.debugStage(stage);
        updateStageUI(pipeline.id, result);
      }
    }
  };
  
  connectBtn.onclick = async () => {
    if (CONFIG.apiKey === '<API-KEY>') {
      alert('Please edit the CONFIG object with your API credentials');
      return;
    }
    
    connectBtn.disabled = true;
    setStatus('disconnected', 'Connecting...');
    statusEl.textContent = 'Connecting...';
    
    try {
      await debugger_.connect();
      setStatus('connected');
      refreshBtn.disabled = false;
      autoBtn.disabled = false;
      connectBtn.textContent = 'Reconnect';
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error));
    }
    
    connectBtn.disabled = false;
  };
  
  refreshBtn.onclick = refreshAll;
  
  autoBtn.onclick = () => {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
      autoBtn.textContent = 'Auto-Refresh (Off)';
      autoBtn.classList.remove('active');
    } else {
      autoRefreshInterval = window.setInterval(refreshAll, 2000);
      autoBtn.textContent = 'Auto-Refresh (On)';
      autoBtn.classList.add('active');
      autoBtn.style.background = 'var(--accent)';
      autoBtn.style.color = '#000';
    }
  };
}

main().catch(console.error);