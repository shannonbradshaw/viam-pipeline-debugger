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
  host: '',
  apiKey: '',      // Replace with your API key
  apiKeyId: '', // Replace with your API key ID
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
        description: 'Left camera cup region'
      },
      { 
        name: 'cam-right-cup-crop', 
        label: 'Right Cup Crop', 
        type: 'camera',
        description: 'Right camera cup region'
      },
      { 
        name: 'cam-merged-cup', 
        label: 'Merged Point Cloud', 
        type: 'camera',
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

interface PointCloudData {
  points: Point3D[];
  normals?: Point3D[];
  boundingBox: { min: Point3D; max: Point3D };
}

interface Object3D {
  label: string;
  center: Point3D;
  dimensions?: Point3D;
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
  objects3d?: Object3D[];
}

// ============================================================================
// PCD Parser
// ============================================================================

function parsePCD(data: Uint8Array): PointCloudData {
  const text = new TextDecoder().decode(data);
  const lines = text.split('\n');
  
  let fields: string[] = [];
  let pointCount = 0;
  let dataStart = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('FIELDS')) fields = line.split(/\s+/).slice(1);
    else if (line.startsWith('POINTS')) pointCount = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith('DATA')) { dataStart = i + 1; break; }
  }
  
  const points: Point3D[] = [];
  const normals: Point3D[] = [];
  
  const xi = Math.max(0, fields.indexOf('x'));
  const yi = Math.max(1, fields.indexOf('y'));
  const zi = Math.max(2, fields.indexOf('z'));
  const nxi = fields.includes('normal_x') ? fields.indexOf('normal_x') : fields.indexOf('nx');
  const nyi = fields.includes('normal_y') ? fields.indexOf('normal_y') : fields.indexOf('ny');
  const nzi = fields.includes('normal_z') ? fields.indexOf('normal_z') : fields.indexOf('nz');
  
  for (let i = dataStart; i < lines.length && points.length < pointCount; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 3) {
      const x = parseFloat(parts[xi]);
      const y = parseFloat(parts[yi]);
      const z = parseFloat(parts[zi]);
      
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
  };
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
  
  async getObjectPointClouds(visionName: string, cameraName: string): Promise<Object3D[]> {
    if (!this.machine) throw new Error('Not connected');
    const vision = new VIAM.VisionClient(this.machine, visionName);
    const objects = await vision.getObjectPointClouds(cameraName);
    
    return objects.map((obj: any, i: number) => {
      // Extract geometry info if available
      const geo = obj.geometries?.[0];
      return {
        label: geo?.label || `object-${i}`,
        center: geo?.center || { x: 0, y: 0, z: 0 },
        dimensions: geo?.box ? {
          x: geo.box.dimsMm?.x || 0,
          y: geo.box.dimsMm?.y || 0,
          z: geo.box.dimsMm?.z || 0,
        } : undefined,
      };
    });
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
        // Try to get 2D image first
        try {
          result.image = await this.getCameraImage(stage.name);
        } catch (e) {
          // Camera might only support point clouds
        }
        
        // Try to get point cloud
        try {
          result.pointCloud = await this.getPointCloud(stage.name);
        } catch (e) {
          // Camera might not support point clouds
        }
        
        result.success = !!(result.image || result.pointCloud);
        if (!result.success) {
          result.error = 'Camera returned neither image nor point cloud';
        }
      } else if (stage.type === 'vision' && stage.sourceCamera) {
        result.detections = await this.getDetections(stage.name, stage.sourceCamera);
        result.success = true;
      } else if (stage.type === 'vision-3d' && stage.sourceCamera) {
        result.objects3d = await this.getObjectPointClouds(stage.name, stage.sourceCamera);
        result.success = true;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    
    result.latencyMs = Math.round(performance.now() - start);
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
      };
    }
  } else if (result.pointCloud) {
    const pc = result.pointCloud;
    const size = {
      x: (pc.boundingBox.max.x - pc.boundingBox.min.x).toFixed(0),
      y: (pc.boundingBox.max.y - pc.boundingBox.min.y).toFixed(0),
      z: (pc.boundingBox.max.z - pc.boundingBox.min.z).toFixed(0),
    };
    contentEl.innerHTML = `
      <div class="no-data" style="background:#111;border-radius:4px;padding:30px;">
        Point Cloud Data<br>
        <span class="pc-info">
          ${pc.points.length.toLocaleString()} points | 
          ${size.x}×${size.y}×${size.z} mm
          ${pc.normals ? ' | ✓ normals' : ''}
        </span>
      </div>
    `;
  } else if (result.detections) {
    if (result.detections.length === 0) {
      contentEl.innerHTML = `<div class="no-data">No detections</div>`;
    } else {
      contentEl.innerHTML = `
        <div class="detections">
          ${result.detections.map(d => `
            <div class="detection">
              <span>${d.className}</span>
              <span>${(d.confidence * 100).toFixed(1)}%</span>
            </div>
          `).join('')}
        </div>
      `;
    }
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
              </span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
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