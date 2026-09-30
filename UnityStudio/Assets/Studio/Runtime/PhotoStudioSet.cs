using System;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Studio
{
    public sealed class PhotoStudioSet : IDisposable
    {
        public static readonly Color[] Backgrounds = { new Color32(224, 226, 228, 255), new Color32(83, 89, 95, 255), new Color32(166, 195, 183, 255) };
        public int BackgroundIndex { get; private set; }
        public const float MaxIntensity = 10;
        public float[] Intensities { get; } = { 4.5f, 1.8f, 3.5f };
        public bool Active { get; private set; }
        public int SurfaceVertices => mesh == null ? 0 : mesh.vertexCount;
        public int ActiveLights => lights.Count(light => light != null && light.isActiveAndEnabled);
        public int VisibleOriginalRenderers => hiddenRenderers.Count(renderer => renderer != null && renderer.enabled);
        public Color BackgroundColor => material == null ? Backgrounds[BackgroundIndex] : material.GetColor("_BaseColor");
        public float[] LightIntensities => lights.Select(light => light == null ? 0 : light.intensity).ToArray();
        private readonly Transform actor;
        private readonly Camera camera;
        private readonly Material sourceMaterial;
        private readonly Light[] lights = new Light[3];
        private GameObject root;
        private Mesh mesh;
        private Material material;
        private Renderer[] hiddenRenderers = Array.Empty<Renderer>();
        private Light[] hiddenLights = Array.Empty<Light>();
        private AmbientMode savedAmbientMode;
        private Color savedAmbient;
        private CameraClearFlags savedClearFlags;
        private Color savedBackground;

        public PhotoStudioSet(Transform actor, Camera camera, Material sourceMaterial)
        {
            this.actor = actor;
            this.camera = camera;
            this.sourceMaterial = sourceMaterial;
        }

        public void Enter()
        {
            if (Active) return;
            var actorMesh = actor.GetComponentInChildren<SkinnedMeshRenderer>();
            if (actorMesh == null) throw new InvalidOperationException("Photo subject mesh is missing.");
            if (root == null) Build();
            root.transform.position = new Vector3(actorMesh.bounds.center.x, actorMesh.bounds.min.y, actorMesh.bounds.center.z);
            root.transform.rotation = Quaternion.LookRotation(Vector3.ProjectOnPlane(camera.transform.forward, Vector3.up).normalized);
            hiddenRenderers = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None)
                .Where(renderer => renderer.enabled && !renderer.transform.IsChildOf(actor) && !renderer.transform.IsChildOf(root.transform)).ToArray();
            hiddenLights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsSortMode.None)
                .Where(light => light.enabled && !light.transform.IsChildOf(root.transform)).ToArray();
            savedAmbientMode = RenderSettings.ambientMode;
            savedAmbient = RenderSettings.ambientLight;
            savedClearFlags = camera.clearFlags;
            savedBackground = camera.backgroundColor;
            foreach (var renderer in hiddenRenderers) renderer.enabled = false;
            foreach (var light in hiddenLights) light.enabled = false;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.18f, 0.18f, 0.18f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            root.SetActive(true);
            Active = true;
            SetBackground(BackgroundIndex);
        }

        public void Exit()
        {
            if (!Active) return;
            root.SetActive(false);
            foreach (var renderer in hiddenRenderers) if (renderer != null) renderer.enabled = true;
            foreach (var light in hiddenLights) if (light != null) light.enabled = true;
            RenderSettings.ambientMode = savedAmbientMode;
            RenderSettings.ambientLight = savedAmbient;
            camera.clearFlags = savedClearFlags;
            camera.backgroundColor = savedBackground;
            hiddenRenderers = Array.Empty<Renderer>();
            hiddenLights = Array.Empty<Light>();
            Active = false;
        }

        public void SetBackground(int index)
        {
            if (index < 0 || index >= Backgrounds.Length) return;
            BackgroundIndex = index;
            if (material != null) material.SetColor("_BaseColor", Backgrounds[index]);
            if (Active) camera.backgroundColor = Backgrounds[index];
        }

        public void AlignSubject(Bounds bounds)
        {
            if (Active) root.transform.position = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
        }

        public void SetIntensity(int index, float value)
        {
            if (index < 0 || index >= lights.Length || !float.IsFinite(value)) return;
            Intensities[index] = Mathf.Clamp(value, 0, MaxIntensity);
            if (lights[index] != null) lights[index].intensity = Intensities[index];
        }

        private void Build()
        {
            if (sourceMaterial == null) throw new InvalidOperationException("Photo backdrop material is missing. Run ConfigureWorkbench.");
            root = new GameObject("Photo Studio Set");
            root.SetActive(false);
            material = new Material(sourceMaterial) { name = "Photo Backdrop Runtime" };
            const int arcSteps = 16;
            int rows = arcSteps + 3;
            var vertices = new Vector3[rows * 2];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[(rows - 1) * 6];
            for (int row = 0; row < rows; row++)
            {
                float angle = Mathf.Clamp01((row - 1f) / arcSteps) * Mathf.PI * 0.5f;
                float depth = row == 0 ? -10 : 3 + 1.5f * Mathf.Sin(angle);
                float height = row == rows - 1 ? 7 : 1.5f * (1 - Mathf.Cos(angle));
                vertices[row * 2] = new Vector3(-7, height, depth);
                vertices[row * 2 + 1] = new Vector3(7, height, depth);
                uv[row * 2] = new Vector2(0, row / (float)(rows - 1));
                uv[row * 2 + 1] = new Vector2(1, row / (float)(rows - 1));
                if (row == rows - 1) continue;
                int vertex = row * 2;
                int triangle = row * 6;
                triangles[triangle] = vertex;
                triangles[triangle + 1] = vertex + 2;
                triangles[triangle + 2] = vertex + 1;
                triangles[triangle + 3] = vertex + 1;
                triangles[triangle + 4] = vertex + 2;
                triangles[triangle + 5] = vertex + 3;
            }
            mesh = new Mesh { name = "Photo Cyclorama", vertices = vertices, uv = uv, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            var backdrop = new GameObject("Cyclorama", typeof(MeshFilter), typeof(MeshRenderer));
            backdrop.transform.SetParent(root.transform, false);
            backdrop.GetComponent<MeshFilter>().sharedMesh = mesh;
            backdrop.GetComponent<MeshRenderer>().sharedMaterial = material;
            AddLight(0, "Key", new Vector3(-3, 4, -3), new Color(1, 0.94f, 0.88f));
            AddLight(1, "Fill", new Vector3(3, 2.5f, -2), new Color(0.87f, 0.94f, 1));
            AddLight(2, "Rim", new Vector3(1.5f, 3.5f, 2.5f), Color.white);
        }

        private void AddLight(int index, string name, Vector3 position, Color color)
        {
            var host = new GameObject("Photo " + name, typeof(Light));
            host.transform.SetParent(root.transform, false);
            host.transform.localPosition = position;
            host.transform.LookAt(root.transform.TransformPoint(new Vector3(0, 1, 0)));
            var light = host.GetComponent<Light>();
            light.type = LightType.Spot;
            light.range = 20;
            light.spotAngle = 85;
            light.innerSpotAngle = 55;
            light.color = color;
            light.intensity = Intensities[index];
            light.shadows = LightShadows.Soft;
            lights[index] = light;
        }

        public void Dispose()
        {
            Exit();
            if (root != null) UnityEngine.Object.Destroy(root);
            if (material != null) UnityEngine.Object.Destroy(material);
            if (mesh != null) UnityEngine.Object.Destroy(mesh);
        }
    }
}