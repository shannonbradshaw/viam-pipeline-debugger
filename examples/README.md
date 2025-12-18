# Wine Robot Pipeline Debugger Example

A working example that connects to the vino1-main wine-pouring robot and debugs its camera pipelines.

## Setup

1. **Edit credentials** in `wine-robot-debugger.ts`:
   ```typescript
   const CONFIG = {
     host: 'vino1-main.kssbd6djf3.viam.cloud',
     apiKey: 'YOUR_API_KEY',      // Replace this
     apiKeyId: 'YOUR_API_KEY_ID', // Replace this
   };
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the dev server**:
   ```bash
   npm run dev
   ```

4. **Open in browser**: http://localhost:5173

## Pipelines Debugged

| Pipeline | Description |
|----------|-------------|
| Left Arm Glass Detection | left-cam → glass-finder → crop → cup-crop |
| Right Arm Glass Detection | right-cam → glass-finder → crop → cup-crop |
| Pour Position Detection | cam-glass → pour-glass-find-service |
| Bottle Detection | right-cam → cam-right-bottle-crop |
| Merged Cup View | left+right cup crops → merged → 3D segmentation |

## Usage

1. Click **Connect** to connect to the robot
2. Click **Refresh All** to fetch data from all pipeline stages
3. Click **Auto-Refresh** to continuously poll every 2 seconds

Each stage shows:
- ✓/✗ success status
- Latency in milliseconds
- Image preview (for 2D cameras)
- Point cloud stats (for depth cameras)
- Detection list with confidence scores (for vision services)
