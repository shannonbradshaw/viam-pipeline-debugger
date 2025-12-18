/**
 * Point Cloud Renderer
 * WebGL-based 3D point cloud visualization with normal vectors
 */

import type { PointCloudData, Point3D } from "./debugger";

export interface RenderOptions {
  /** Show normal vectors as lines */
  showNormals: boolean;
  /** Length of normal vector lines */
  normalLength: number;
  /** Point size in pixels */
  pointSize: number;
  /** Background color */
  backgroundColor: [number, number, number, number];
  /** Point color (if no colors in data) */
  pointColor: [number, number, number];
  /** Normal vector color */
  normalColor: [number, number, number];
  /** Color points by height (Z) */
  colorByHeight: boolean;
  /** Color points by normal direction */
  colorByNormal: boolean;
  /** Show bounding box */
  showBoundingBox: boolean;
  /** Show axes */
  showAxes: boolean;
}

const DEFAULT_OPTIONS: RenderOptions = {
  showNormals: true,
  normalLength: 10,
  pointSize: 2,
  backgroundColor: [0.05, 0.05, 0.1, 1],
  pointColor: [0.3, 0.7, 1.0],
  normalColor: [1.0, 0.3, 0.3],
  colorByHeight: true,
  colorByNormal: false,
  showBoundingBox: true,
  showAxes: true,
};

// Vertex shader for points
const POINT_VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  
  uniform mat4 uProjection;
  uniform mat4 uModelView;
  uniform float uPointSize;
  
  varying vec3 vColor;
  
  void main() {
    gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
    gl_PointSize = uPointSize;
    vColor = aColor;
  }
`;

// Fragment shader for points
const POINT_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vColor;
  
  void main() {
    // Make points circular
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (length(coord) > 0.5) discard;
    
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// Vertex shader for lines (normals, axes, bounding box)
const LINE_VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aColor;
  
  uniform mat4 uProjection;
  uniform mat4 uModelView;
  
  varying vec3 vColor;
  
  void main() {
    gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
    vColor = aColor;
  }
`;

// Fragment shader for lines
const LINE_FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vColor;
  
  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

export class PointCloudRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private options: RenderOptions;

  // Shaders
  private pointProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;

  // Buffers
  private pointPositionBuffer: WebGLBuffer | null = null;
  private pointColorBuffer: WebGLBuffer | null = null;
  private linePositionBuffer: WebGLBuffer | null = null;
  private lineColorBuffer: WebGLBuffer | null = null;

  // Data
  private pointCount: number = 0;
  private lineVertexCount: number = 0;
  private boundingBox: { min: Point3D; max: Point3D } | null = null;

  // Camera
  private cameraDistance: number = 500;
  private cameraRotationX: number = -30;
  private cameraRotationY: number = 45;
  private cameraTarget: Point3D = { x: 0, y: 0, z: 0 };

  // Interaction
  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor(canvas: HTMLCanvasElement, options: Partial<RenderOptions> = {}) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    const gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) {
      throw new Error("WebGL not supported");
    }
    this.gl = gl;

    this.initShaders();
    this.initBuffers();
    this.setupInteraction();

    // Initial render
    this.render();
  }

  private initShaders(): void {
    const gl = this.gl;

    // Point shader program
    this.pointProgram = this.createProgram(POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);

    // Line shader program
    this.lineProgram = this.createProgram(LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error("Vertex shader compile error: " + gl.getShaderInfoLog(vertexShader));
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error("Fragment shader compile error: " + gl.getShaderInfoLog(fragmentShader));
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Program link error: " + gl.getProgramInfoLog(program));
    }

    return program;
  }

  private initBuffers(): void {
    const gl = this.gl;
    this.pointPositionBuffer = gl.createBuffer();
    this.pointColorBuffer = gl.createBuffer();
    this.linePositionBuffer = gl.createBuffer();
    this.lineColorBuffer = gl.createBuffer();
  }

  private setupInteraction(): void {
    // Mouse drag for rotation
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;

      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;

      this.cameraRotationY += dx * 0.5;
      this.cameraRotationX += dy * 0.5;

      // Clamp vertical rotation
      this.cameraRotationX = Math.max(-90, Math.min(90, this.cameraRotationX));

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.render();
    });

    // Mouse wheel for zoom
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.cameraDistance *= e.deltaY > 0 ? 1.1 : 0.9;
      this.cameraDistance = Math.max(10, Math.min(5000, this.cameraDistance));
      this.render();
    });
  }

  setOptions(options: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...options };
    this.render();
  }

  setData(data: PointCloudData): void {
    const gl = this.gl;
    const { points, normals } = data;

    this.boundingBox = data.boundingBox;
    this.pointCount = points.length;

    // Center camera on point cloud
    this.cameraTarget = {
      x: (data.boundingBox.min.x + data.boundingBox.max.x) / 2,
      y: (data.boundingBox.min.y + data.boundingBox.max.y) / 2,
      z: (data.boundingBox.min.z + data.boundingBox.max.z) / 2,
    };

    // Set camera distance based on bounding box size
    const size = Math.max(
      data.boundingBox.max.x - data.boundingBox.min.x,
      data.boundingBox.max.y - data.boundingBox.min.y,
      data.boundingBox.max.z - data.boundingBox.min.z
    );
    this.cameraDistance = size * 2;

    // Build point position array
    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y;
      positions[i * 3 + 2] = points[i].z;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Build point color array
    const colors = new Float32Array(points.length * 3);
    const zRange = data.boundingBox.max.z - data.boundingBox.min.z || 1;

    for (let i = 0; i < points.length; i++) {
      if (this.options.colorByHeight) {
        // Color by Z height (rainbow gradient)
        const t = (points[i].z - data.boundingBox.min.z) / zRange;
        const rgb = hslToRgb(t * 0.7, 0.8, 0.5); // Hue from blue to red
        colors[i * 3] = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
      } else if (this.options.colorByNormal && normals && normals[i]) {
        // Color by normal direction
        colors[i * 3] = Math.abs(normals[i].x);
        colors[i * 3 + 1] = Math.abs(normals[i].y);
        colors[i * 3 + 2] = Math.abs(normals[i].z);
      } else {
        colors[i * 3] = this.options.pointColor[0];
        colors[i * 3 + 1] = this.options.pointColor[1];
        colors[i * 3 + 2] = this.options.pointColor[2];
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    // Build line vertices for normals, axes, and bounding box
    this.buildLineData(data);

    this.render();
  }

  private buildLineData(data: PointCloudData): void {
    const gl = this.gl;
    const linePositions: number[] = [];
    const lineColors: number[] = [];

    const { points, normals } = data;
    const nc = this.options.normalColor;

    // Normal vectors
    if (this.options.showNormals && normals) {
      const step = Math.max(1, Math.floor(points.length / 5000)); // Limit normals for performance
      for (let i = 0; i < points.length; i += step) {
        if (normals[i]) {
          const p = points[i];
          const n = normals[i];
          const len = this.options.normalLength;

          // Start point
          linePositions.push(p.x, p.y, p.z);
          lineColors.push(nc[0], nc[1], nc[2]);

          // End point
          linePositions.push(p.x + n.x * len, p.y + n.y * len, p.z + n.z * len);
          lineColors.push(nc[0] * 0.5, nc[1] * 0.5, nc[2] * 0.5);
        }
      }
    }

    // Axes
    if (this.options.showAxes) {
      const axisLength = this.cameraDistance * 0.3;
      const origin = this.cameraTarget;

      // X axis (red)
      linePositions.push(origin.x, origin.y, origin.z);
      lineColors.push(1, 0, 0);
      linePositions.push(origin.x + axisLength, origin.y, origin.z);
      lineColors.push(1, 0, 0);

      // Y axis (green)
      linePositions.push(origin.x, origin.y, origin.z);
      lineColors.push(0, 1, 0);
      linePositions.push(origin.x, origin.y + axisLength, origin.z);
      lineColors.push(0, 1, 0);

      // Z axis (blue)
      linePositions.push(origin.x, origin.y, origin.z);
      lineColors.push(0, 0, 1);
      linePositions.push(origin.x, origin.y, origin.z + axisLength);
      lineColors.push(0, 0, 1);
    }

    // Bounding box
    if (this.options.showBoundingBox && this.boundingBox) {
      const { min, max } = this.boundingBox;
      const bc = [0.5, 0.5, 0.5]; // Box color (gray)

      // Bottom face
      this.addBoxEdge(linePositions, lineColors, min.x, min.y, min.z, max.x, min.y, min.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, min.y, min.z, max.x, max.y, min.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, max.y, min.z, min.x, max.y, min.z, bc);
      this.addBoxEdge(linePositions, lineColors, min.x, max.y, min.z, min.x, min.y, min.z, bc);

      // Top face
      this.addBoxEdge(linePositions, lineColors, min.x, min.y, max.z, max.x, min.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, min.y, max.z, max.x, max.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, max.y, max.z, min.x, max.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, min.x, max.y, max.z, min.x, min.y, max.z, bc);

      // Vertical edges
      this.addBoxEdge(linePositions, lineColors, min.x, min.y, min.z, min.x, min.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, min.y, min.z, max.x, min.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, max.x, max.y, min.z, max.x, max.y, max.z, bc);
      this.addBoxEdge(linePositions, lineColors, min.x, max.y, min.z, min.x, max.y, max.z, bc);
    }

    this.lineVertexCount = linePositions.length / 3;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.linePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(linePositions), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineColors), gl.STATIC_DRAW);
  }

  private addBoxEdge(
    positions: number[],
    colors: number[],
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    color: number[]
  ): void {
    positions.push(x1, y1, z1);
    colors.push(color[0], color[1], color[2]);
    positions.push(x2, y2, z2);
    colors.push(color[0], color[1], color[2]);
  }

  render(): void {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;

    gl.viewport(0, 0, width, height);

    // Clear
    const bg = this.options.backgroundColor;
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    // Calculate matrices
    const projection = perspectiveMatrix(45, width / height, 1, 10000);
    const modelView = this.calculateModelViewMatrix();

    // Render points
    if (this.pointCount > 0 && this.pointProgram) {
      gl.useProgram(this.pointProgram);

      const projLoc = gl.getUniformLocation(this.pointProgram, "uProjection");
      const mvLoc = gl.getUniformLocation(this.pointProgram, "uModelView");
      const sizeLoc = gl.getUniformLocation(this.pointProgram, "uPointSize");

      gl.uniformMatrix4fv(projLoc, false, projection);
      gl.uniformMatrix4fv(mvLoc, false, modelView);
      gl.uniform1f(sizeLoc, this.options.pointSize);

      const posAttr = gl.getAttribLocation(this.pointProgram, "aPosition");
      const colAttr = gl.getAttribLocation(this.pointProgram, "aColor");

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointPositionBuffer);
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
      gl.enableVertexAttribArray(colAttr);
      gl.vertexAttribPointer(colAttr, 3, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, this.pointCount);
    }

    // Render lines
    if (this.lineVertexCount > 0 && this.lineProgram) {
      gl.useProgram(this.lineProgram);

      const projLoc = gl.getUniformLocation(this.lineProgram, "uProjection");
      const mvLoc = gl.getUniformLocation(this.lineProgram, "uModelView");

      gl.uniformMatrix4fv(projLoc, false, projection);
      gl.uniformMatrix4fv(mvLoc, false, modelView);

      const posAttr = gl.getAttribLocation(this.lineProgram, "aPosition");
      const colAttr = gl.getAttribLocation(this.lineProgram, "aColor");

      gl.bindBuffer(gl.ARRAY_BUFFER, this.linePositionBuffer);
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineColorBuffer);
      gl.enableVertexAttribArray(colAttr);
      gl.vertexAttribPointer(colAttr, 3, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.LINES, 0, this.lineVertexCount);
    }
  }

  private calculateModelViewMatrix(): Float32Array {
    const radX = (this.cameraRotationX * Math.PI) / 180;
    const radY = (this.cameraRotationY * Math.PI) / 180;

    // Camera position in spherical coordinates
    const camX = this.cameraTarget.x + this.cameraDistance * Math.cos(radX) * Math.sin(radY);
    const camY = this.cameraTarget.y + this.cameraDistance * Math.sin(radX);
    const camZ = this.cameraTarget.z + this.cameraDistance * Math.cos(radX) * Math.cos(radY);

    return lookAtMatrix(
      camX, camY, camZ,
      this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z,
      0, 1, 0
    );
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.render();
  }

  dispose(): void {
    const gl = this.gl;
    if (this.pointPositionBuffer) gl.deleteBuffer(this.pointPositionBuffer);
    if (this.pointColorBuffer) gl.deleteBuffer(this.pointColorBuffer);
    if (this.linePositionBuffer) gl.deleteBuffer(this.linePositionBuffer);
    if (this.lineColorBuffer) gl.deleteBuffer(this.lineColorBuffer);
    if (this.pointProgram) gl.deleteProgram(this.pointProgram);
    if (this.lineProgram) gl.deleteProgram(this.lineProgram);
  }
}

// ============================================================================
// Matrix Utilities
// ============================================================================

function perspectiveMatrix(fovDegrees: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan((fovDegrees * Math.PI) / 360);
  const nf = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAtMatrix(
  eyeX: number, eyeY: number, eyeZ: number,
  centerX: number, centerY: number, centerZ: number,
  upX: number, upY: number, upZ: number
): Float32Array {
  let fx = centerX - eyeX;
  let fy = centerY - eyeY;
  let fz = centerZ - eyeZ;

  const rlf = 1 / Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx *= rlf;
  fy *= rlf;
  fz *= rlf;

  let sx = fy * upZ - fz * upY;
  let sy = fz * upX - fx * upZ;
  let sz = fx * upY - fy * upX;

  const rls = 1 / Math.sqrt(sx * sx + sy * sy + sz * sz);
  sx *= rls;
  sy *= rls;
  sz *= rls;

  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;

  return new Float32Array([
    sx, ux, -fx, 0,
    sy, uy, -fy, 0,
    sz, uz, -fz, 0,
    -(sx * eyeX + sy * eyeY + sz * eyeZ),
    -(ux * eyeX + uy * eyeY + uz * eyeZ),
    fx * eyeX + fy * eyeY + fz * eyeZ,
    1,
  ]);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [r, g, b];
}
