/**
 * Viam Pipeline Debugger
 * General-purpose visual debugging tool for Viam component pipelines
 */

// Core debugger
export {
  PipelineDebugger,
  createDebugger,
  parseResourceName,
  inferResourceType,
  parsePCD,
} from "./debugger";

export type {
  ResourceType,
  PipelineStage,
  Pipeline,
  Detection,
  Classification,
  Point3D,
  PointCloudData,
  StageResult,
  DebuggerConfig,
} from "./debugger";

// Point cloud renderer
export { PointCloudRenderer } from "./pointcloud-renderer";
export type { RenderOptions } from "./pointcloud-renderer";

// React components
export {
  PipelineDebuggerDashboard,
  ConnectionPanel,
  PipelineConfig,
  PipelinePanel,
  StagePanel,
  ImageViewer,
  PointCloudViewer,
  DetectionList,
  PointCloudOptions,
} from "./dashboard";

export type { DashboardProps } from "./dashboard";

// Re-export CSS path for consumers
export const CSS_PATH = "viam-pipeline-debugger/src/dashboard.css";
