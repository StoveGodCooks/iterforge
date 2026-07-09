/* Feature flags — flip to re-enable parked pipelines.
 *
 * 3D mesh + multi-view generation is parked while the 2D sprite pipeline
 * gets solid. Setting ENABLE_3D = true brings back:
 *   - the "3D Multi-View" smelt mode            (Smelting.tsx)
 *   - the "3D Mesh" forge pipeline               (Forge.tsx)
 *   - the 3D-view "Sprite Sheet" atlas packer    (Forge.tsx)
 * Nothing is deleted — these just stop rendering while the flag is false.
 */
export const ENABLE_3D = false;
