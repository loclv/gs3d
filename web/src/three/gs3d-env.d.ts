declare module './gs3d/app.js' {
  const createGoose3D: (options?: { locateFile?: (path: string) => string }) => Promise<any>;
  export default createGoose3D;
}
