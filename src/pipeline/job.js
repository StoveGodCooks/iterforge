/**
 * PipelineJob — state container and progress tracker for a single generation run.
 */
export class PipelineJob {
  constructor(config, onProgress) {
    this.id         = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.config     = config;
    this.onProgress = onProgress;
    this.startTime  = Date.now();
    this.status     = 'pending';
    this.error      = null;
    
    // Shared state across stages
    this.state = {
      images:   {},      // { front, left, back, right } - absolute paths
      masks:    {},      // { front, ... } - boolean masks or rembg results
      mesh:     null,    // STL path
      uvs:      null,    // .npz path
      glb:      null,    // GLB path
      dxf:      null,    // DXF path
      lods:     [],      // [STL paths]
      seed:     config.generate?.seed ?? null,
      history:  null,    // Final history entry
    };
  }

  /**
   * Execute a pipeline stage with tracking and error handling.
   */
  async stage(name, fn) {
    console.log(`[Pipeline] Stage: ${name.toUpperCase()} ...`);
    this.onProgress?.({ id: this.id, stage: name, status: 'running', timestamp: Date.now() });
    
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      this.onProgress?.({ id: this.id, stage: name, status: 'done', duration, timestamp: Date.now() });
    } catch (err) {
      this.status = 'failed';
      this.error  = err.message;
      this.onProgress?.({ id: this.id, stage: name, status: 'failed', error: err.message, timestamp: Date.now() });
      throw err;
    }
  }

  fail(err) {
    this.status = 'failed';
    this.error  = err.message;
  }

  result() {
    return {
      id:      this.id,
      status:  this.status,
      error:   this.error,
      outputs: this.state,
    };
  }
}
