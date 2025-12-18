# Viam Pipeline Debugger

A general-purpose visual debugging tool for Viam component pipelines. Debug camera → vision service → transform camera pipelines with real-time visualization, including point cloud rendering with normal vectors.

## Features

- **Configurable Pipelines**: Define pipelines by component names, works with any Viam project
- **Auto-Discovery**: Automatically detects cameras and vision services from your machine
- **Universal Support**: Works with cameras, vision services, point clouds, and transforms
- **Point Cloud Visualization**: WebGL-based 3D rendering with normal vectors, bounding boxes, and axes
- **Detection Overlay**: Bounding boxes and confidence scores drawn on images
- **Real-time Updates**: Auto-refresh mode for continuous monitoring

## Installation

```bash
npm install viam-pipeline-debugger @viamrobotics/sdk react react-dom
```

## Quick Start

### React Application

```tsx
import { PipelineDebuggerDashboard } from 'viam-pipeline-debugger';
import 'viam-pipeline-debugger/src/dashboard.css';

function App() {
  return (
    <PipelineDebuggerDashboard
      pipelines={[
        {
          id: 'main',
          name: 'Vision Pipeline',
          stages: [
            { name: 'webcam' },
            { name: 'object-detector', sourceCamera: 'webcam' },
            { name: 'cropped-view' }
          ]
        }
      ]}
      refreshInterval={2000}
    />
  );
}
```

### Programmatic Usage

```typescript
import { createDebugger, Pipeline } from 'viam-pipeline-debugger';

const debugger = createDebugger();

// Connect to your machine
await debugger.connect(
  'your-machine.viam.cloud',
  'your-api-key',
  'your-api-key-id'
);

// Define a pipeline
const pipeline: Pipeline = {
  id: 'glass-detection',
  name: 'Glass Detection Pipeline',
  stages: [
    { name: 'realsense-camera' },
    { name: 'glass-detector', sourceCamera: 'realsense-camera' },
    { name: 'glass-crop-camera' }
  ]
};

// Debug the entire pipeline
const results = await debugger.debugPipeline(pipeline);

for (const result of results) {
  console.log(`${result.stageName}: ${result.success ? '✓' : '✗'} (${result.latencyMs}ms)`);
  
  if (result.detections) {
    console.log(`  Found ${result.detections.length} detections`);
  }
  
  if (result.pointCloud) {
    console.log(`  Point cloud: ${result.pointCloud.points.length} points`);
  }
}

await debugger.disconnect();
```

## API

### PipelineDebugger

```typescript
const dbg = createDebugger();

// Connection
await dbg.connect(host, apiKey, apiKeyId);
await dbg.disconnect();

// Discovery
dbg.getCameras();        // string[]
dbg.getVisionServices(); // string[]
dbg.getResourceType(name); // 'camera' | 'vision' | 'unknown'

// Data fetching
await dbg.getCameraImage(cameraName);
await dbg.getPointCloud(cameraName);
await dbg.getDetections(visionName, cameraName);
await dbg.getClassifications(visionName, cameraName, count);

// Debugging
await dbg.debugStage(stage, defaultCamera?);
await dbg.debugPipeline(pipeline);

// Streaming
await dbg.startStream(cameraName, videoElement);
dbg.stopStream(cameraName);
```

### Types

```typescript
interface PipelineStage {
  name: string;           // Viam resource name
  label?: string;         // Display label
  sourceCamera?: string;  // For vision services
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface StageResult {
  stageName: string;
  resourceType: 'camera' | 'vision' | 'unknown';
  timestamp: Date;
  latencyMs: number;
  success: boolean;
  error?: string;
  image?: { data: Uint8Array; mimeType: string };
  pointCloud?: PointCloudData;
  detections?: Detection[];
  classifications?: Classification[];
}

interface PointCloudData {
  points: Point3D[];
  normals?: Point3D[];
  boundingBox: { min: Point3D; max: Point3D };
}
```

### Point Cloud Renderer

```typescript
import { PointCloudRenderer } from 'viam-pipeline-debugger';

const renderer = new PointCloudRenderer(canvas, {
  showNormals: true,      // Display normal vectors
  normalLength: 10,       // Normal vector length
  pointSize: 2,           // Point size in pixels
  colorByHeight: true,    // Color by Z height
  showBoundingBox: true,  // Show wireframe box
  showAxes: true,         // Show X/Y/Z axes
});

renderer.setData(pointCloudData);
renderer.setOptions({ showNormals: false });
```

## Example Pipelines

### Basic Detection
```typescript
{
  id: 'basic',
  name: 'Object Detection',
  stages: [
    { name: 'webcam' },
    { name: 'yolo-detector', sourceCamera: 'webcam' },
  ]
}
```

### Depth + 3D Segmentation
```typescript
{
  id: 'depth',
  name: 'Point Cloud Pipeline',
  stages: [
    { name: 'realsense' },
    { name: 'cropped-region' },
    { name: 'obstacle-segmenter', sourceCamera: 'cropped-region' },
  ]
}
```

### Multi-Camera
```typescript
{
  id: 'stereo',
  name: 'Left/Right Cameras',
  stages: [
    { name: 'left-cam', label: 'Left' },
    { name: 'right-cam', label: 'Right' },
    { name: 'merged-pointcloud' },
  ]
}
```

## Project Structure

```
viam-pipeline-debugger/
├── src/
│   ├── index.ts              # Main exports
│   ├── debugger.ts           # Core PipelineDebugger class
│   ├── pointcloud-renderer.ts # WebGL point cloud visualization
│   ├── dashboard.tsx         # React components
│   └── dashboard.css         # Styles
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
