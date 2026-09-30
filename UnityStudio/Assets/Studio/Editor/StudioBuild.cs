using System;
using System.IO;
using System.Linq;
using UMA;
using UMA.CharacterSystem;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;

namespace Studio.Editor
{
    public static class StudioBuild
    {
        private const string SourceScene = "Assets/UMA/SRP/Samples/Scenes/U3-Character Creator.unity";
        private const string StudioScene = "Assets/Studio/Scenes/Studio.unity";
        private const string PipelinePath = "Assets/Studio/Settings/StudioPipeline.asset";
        private const string RendererPath = "Assets/Studio/Settings/StudioRenderer.asset";

        public static void Configure()
        {
            EnsureFolder("Assets/Studio/Scenes");
            EnsureFolder("Assets/Studio/Settings");

            var pipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if (pipeline == null)
            {
                var renderer = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(RendererPath);
                if (renderer == null)
                {
                    renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                    AssetDatabase.CreateAsset(renderer, RendererPath);
                }

                pipeline = UniversalRenderPipelineAsset.Create(renderer);
                pipeline.msaaSampleCount = 2;
                pipeline.shadowDistance = 30;
                AssetDatabase.CreateAsset(pipeline, PipelinePath);
            }

            GraphicsSettings.defaultRenderPipeline = pipeline;
            ConfigureUIShaders();
            int originalQuality = QualitySettings.GetQualityLevel();
            for (int qualityIndex = 0; qualityIndex < QualitySettings.names.Length; qualityIndex++)
            {
                QualitySettings.SetQualityLevel(qualityIndex, false);
                QualitySettings.renderPipeline = pipeline;
            }
            QualitySettings.SetQualityLevel(originalQuality, false);

            PlayerSettings.companyName = "LocalStudio";
            PlayerSettings.productName = "Lights Camera Action";
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.runInBackground = true;
            PlayerSettings.defaultWebScreenWidth = 1280;
            PlayerSettings.defaultWebScreenHeight = 720;
            PlayerSettings.WebGL.useEmbeddedResources = true;
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.Minimal);

            var playerSettings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset"));
            var inputHandler = playerSettings.FindProperty("activeInputHandler");
            if (inputHandler != null)
            {
                inputHandler.intValue = 2;
                playerSettings.ApplyModifiedPropertiesWithoutUndo();
            }

            var indexer = UMAAssetIndexer.Instance;
            if (indexer == null)
            {
                throw new InvalidOperationException("UMA Global Library is unavailable after import.");
            }
            indexer.AddEverything(true);

            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(StudioScene) == null &&
                !AssetDatabase.CopyAsset(SourceScene, StudioScene))
            {
                throw new InvalidOperationException("Unable to copy the official UMA character creator scene.");
            }

            var scene = EditorSceneManager.OpenScene(StudioScene, OpenSceneMode.Single);
            var avatars = UnityEngine.Object.FindObjectsByType<DynamicCharacterAvatar>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            if (avatars.Length == 0 || cameras.Length == 0)
            {
                throw new InvalidOperationException("The character creator scene must contain a UMA avatar and camera.");
            }

            EditorSceneManager.SaveScene(scene);
            ConfigureWorkbench();
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(StudioScene, true) };
            AssetDatabase.SaveAssets();
            Debug.Log($"[StudioBuild] Configured {StudioScene}; avatars={avatars.Length}; cameras={cameras.Length}; pipeline={pipeline.name}");
        }

        public static void ConfigureWorkbench()
        {
            var scene = EditorSceneManager.OpenScene(StudioScene, OpenSceneMode.Single);
            var sample = UnityEngine.Object.FindFirstObjectByType<NewUMAGUI>(FindObjectsInactive.Include);
            if (sample == null || sample.avatar == null) throw new InvalidOperationException("The UMA sample configuration is missing.");
            var font = AssetDatabase.LoadAssetAtPath<Font>("Assets/Studio/UI/NotoSansCJKsc-Regular.otf");
            if (font == null) throw new InvalidOperationException("The bundled Chinese font is missing.");
            const string fontPath = "Assets/Studio/UI/ChineseFont.asset";
            var fontAsset = AssetDatabase.LoadAssetAtPath<FontAsset>(fontPath);
            if (fontAsset == null)
            {
                fontAsset = FontAsset.CreateFontAsset(font);
                fontAsset.name = "Studio Chinese";
                fontAsset.isMultiAtlasTexturesEnabled = true;
                AssetDatabase.CreateAsset(fontAsset, fontPath);
                AssetDatabase.AddObjectToAsset(fontAsset.material, fontAsset);
                foreach (var texture in fontAsset.atlasTextures) AssetDatabase.AddObjectToAsset(texture, fontAsset);
            }
            string characters = string.Concat(Directory.GetFiles("Assets/Studio/Runtime", "*.cs")
                .Select(File.ReadAllText).SelectMany(text => text).Where(character => character > 127).Distinct());
            if (!fontAsset.TryAddCharacters(characters, out string missing))
                throw new InvalidOperationException("Missing Chinese font glyphs: " + missing);
            foreach (var texture in fontAsset.atlasTextures)
                if (texture != null && string.IsNullOrEmpty(AssetDatabase.GetAssetPath(texture)))
                    AssetDatabase.AddObjectToAsset(texture, fontAsset);
            EditorUtility.SetDirty(fontAsset);

            const string textPath = "Assets/Studio/UI/ChineseTextSettings.asset";
            var textSettings = AssetDatabase.LoadAssetAtPath<PanelTextSettings>(textPath);
            if (textSettings == null)
            {
                textSettings = ScriptableObject.CreateInstance<PanelTextSettings>();
                textSettings.defaultFontAsset = fontAsset;
                AssetDatabase.CreateAsset(textSettings, textPath);
            }
            const string panelPath = "Assets/Studio/UI/WorkbenchPanel.asset";
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(panelPath);
            if (panel == null)
            {
                panel = ScriptableObject.CreateInstance<PanelSettings>();
                AssetDatabase.CreateAsset(panel, panelPath);
            }
            panel.scaleMode = PanelScaleMode.ConstantPixelSize;
            panel.textSettings = textSettings;
            panel.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>("Assets/Studio/UI/Workbench.tss");
            panel.sortingOrder = 100;
            EditorUtility.SetDirty(panel);

            var workbench = UnityEngine.Object.FindFirstObjectByType<CharacterWorkbench>(FindObjectsInactive.Include);
            var host = workbench == null ? new GameObject("Studio Workbench") : workbench.gameObject;
            var document = host.GetComponent<UIDocument>() ?? host.AddComponent<UIDocument>();
            document.panelSettings = panel;
            var session = host.GetComponent<CharacterSession>() ?? host.AddComponent<CharacterSession>();
            if (host.GetComponent<WorkbenchDiagnostics>() == null) host.AddComponent<WorkbenchDiagnostics>();
            session.avatar = sample.avatar;
            ConfigurePoses(session);
            session.bodyParameters = sample.BodyDNA.ToList();
            session.faceParameters = sample.FaceDNA.ToList();
            session.hairParameters = sample.HairDNA.ToList();
            session.legParameters = sample.LegsDNA.ToList();
            session.presets = sample.Presets.Where(preset => preset != null).Distinct().ToList();
            session.wardrobe = sample.BodyItems.Concat(sample.LegsItems).Concat(sample.HairItems).Concat(sample.FaceItems)
                .Where(item => item != null).Distinct().ToList();
            session.colorTables = sample.BodyColors.Concat(sample.LegsColors).Concat(sample.HairColors).Concat(sample.FaceColors)
                .Where(table => table != null).Distinct().ToList();
            workbench = host.GetComponent<CharacterWorkbench>() ?? host.AddComponent<CharacterWorkbench>();
            workbench.session = session;
            workbench.studioCamera = Camera.main;
            workbench.chineseFont = fontAsset;
            workbench.styleSheet = AssetDatabase.LoadAssetAtPath<StyleSheet>("Assets/Studio/UI/Workbench.uss");
            if (workbench.studioCamera == null || workbench.styleSheet == null)
                throw new InvalidOperationException("Workbench camera or style sheet is missing.");
            sample.enabled = false;
            foreach (var canvas in UnityEngine.Object.FindObjectsByType<Canvas>(FindObjectsInactive.Include))
            {
                canvas.enabled = false;
                if (canvas.GetComponentInChildren<DynamicCharacterAvatar>(true) == null && canvas.GetComponentInChildren<Camera>(true) == null)
                    canvas.gameObject.SetActive(false);
            }
            foreach (var eventSystem in UnityEngine.Object.FindObjectsByType<UnityEngine.EventSystems.EventSystem>())
                eventSystem.gameObject.SetActive(false);
            foreach (string parameter in session.bodyParameters.Concat(session.faceParameters).Concat(session.legParameters))
                if (CharacterWorkbench.TranslateParameter(parameter).StartsWith("造型参数"))
                    throw new InvalidOperationException("Missing Chinese parameter label: " + parameter);
            PlayerSettings.WebGL.template = "PROJECT:StudioChinese";
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            Debug.Log("[StudioCatalog] Presets: " + string.Join("; ", session.presets.Select(preset => preset.name + "=" + preset.Definition.RaceName)));
            Debug.Log("[StudioCatalog] Wardrobe: " + string.Join("; ", session.wardrobe.Select(item => item.wardrobeSlot + "=" + item.name)));
            Debug.Log("[StudioCatalog] Colors: " + string.Join("; ", session.colorTables.Select(table => table.sharedColorName + "=" + table.colors.Length)));
            Debug.Log($"[StudioBuild] Chinese workbench configured; fontGlyphs={characters.Length}; body={string.Join(",", session.bodyParameters)}; face={string.Join(",", session.faceParameters)}; hair={string.Join(",", session.hairParameters)}; legs={string.Join(",", session.legParameters)}");
        }

        private static void ConfigurePoses(CharacterSession session)
        {
            const string folder = "Assets/UMA/UMA3/Animation/";
            var idle = AssetDatabase.LoadAssetAtPath<AnimationClip>(folder + "Chal_Idle.anim");
            var relaxed = AssetDatabase.LoadAssetAtPath<AnimationClip>(folder + "UMA_APose.anim");
            var extended = AssetDatabase.LoadAssetAtPath<AnimationClip>(folder + "UMA_TPose.anim");
            var walk = AssetDatabase.LoadAssetAtPath<AnimationClip>(folder + "Chal_Walk.anim");
            var run = AssetDatabase.LoadAllAssetsAtPath(folder + "Runs.fbx").OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__")).OrderBy(clip => clip.name.Length).FirstOrDefault();
            session.poseClips = new[] { idle, relaxed, extended, walk, idle, walk, run };
            const string path = "Assets/Studio/Settings/CharacterPoses.controller";
            var controller = AssetDatabase.LoadAssetAtPath<UnityEditor.Animations.AnimatorController>(path) ??
                UnityEditor.Animations.AnimatorController.CreateAnimatorControllerAtPath(path);
            var machine = controller.layers[0].stateMachine;
            for (int index = 0; index < session.poseClips.Length; index++)
            {
                var clip = session.poseClips[index];
                if (clip == null || !clip.isHumanMotion || clip.length <= 0)
                    throw new InvalidOperationException("Missing or non-humanoid pose clip at " + index);
                string name = "Pose" + index;
                var state = machine.states.Select(entry => entry.state).FirstOrDefault(candidate => candidate.name == name) ?? machine.AddState(name);
                state.motion = clip;
                state.writeDefaultValues = true;
                if (index == 0) machine.defaultState = state;
                EditorUtility.SetDirty(state);
                Debug.Log($"[StudioPose] {index}: {clip.name}; duration={clip.length}; looping={clip.isLooping}");
            }
            EditorUtility.SetDirty(machine);
            EditorUtility.SetDirty(controller);
            session.poseController = controller;
        }

        public static void ValidateCharacterControls()
        {
            var host = new GameObject("Head");
            var data = host.AddComponent<UMAData>();
            var adapter = ScriptableObject.CreateInstance<StudioSwayBoneAnimator>();
            try
            {
                data.skeleton = new UMASkeleton(host.transform);
                adapter.Chains.Add(new SwayBoneAnimator.ChainDefinition { AnchorBoneName = "Head" });
                adapter.Chains.Add(new SwayBoneAnimator.ChainDefinition { AnchorBoneName = "MissingHairAnchor" });
                adapter.Initialize(data, null);
                if (adapter.ValidChains != 1 || adapter.SkippedChains != 1 || adapter.Chains.Count != 2)
                    throw new InvalidOperationException("Bone guard did not preserve valid chains and original configuration.");
                adapter.Chains.RemoveAt(0);
                adapter.Initialize(data, null);
                if (adapter.ValidChains != 0 || adapter.SkippedChains != 1)
                    throw new InvalidOperationException("Missing-only chain was not skipped.");
                for (int sample = 0; sample <= 100; sample++)
                {
                    Color color = CharacterSession.EvaluateSkinTone(sample / 100f);
                    if (color.r < color.g || color.g < color.b || color.a != 1)
                        throw new InvalidOperationException("Skin ramp contains an unexpected color.");
                }
                Debug.Log("[StudioValidation] PASS: valid/missing bone chains, configuration isolation, 101 natural skin samples.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(adapter);
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        public static void ConfigureUIShaders()
        {
            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset"));
            var includedShaders = settings.FindProperty("m_AlwaysIncludedShaders");
            if (includedShaders == null)
            {
                throw new InvalidOperationException("Graphics settings do not expose the shader inclusion list.");
            }

            foreach (string shaderName in new[] { "UI/Default", "UI/Default Font" })
            {
                var shader = Shader.Find(shaderName);
                if (shader == null || ShaderUtil.ShaderHasError(shader))
                {
                    throw new InvalidOperationException($"Required UI shader is missing or has compile errors: {shaderName}");
                }

                if (shaderName == "UI/Default")
                {
                    var material = new Material(shader);
                    bool supportsMasking = material.HasProperty("_Stencil");
                    UnityEngine.Object.DestroyImmediate(material);
                    if (!supportsMasking)
                    {
                        throw new InvalidOperationException("UI/Default does not support the required stencil masking.");
                    }
                }

                bool alreadyIncluded = false;
                for (int shaderIndex = 0; shaderIndex < includedShaders.arraySize; shaderIndex++)
                {
                    alreadyIncluded |= includedShaders.GetArrayElementAtIndex(shaderIndex).objectReferenceValue == shader;
                }
                if (!alreadyIncluded)
                {
                    int shaderIndex = includedShaders.arraySize;
                    includedShaders.InsertArrayElementAtIndex(shaderIndex);
                    includedShaders.GetArrayElementAtIndex(shaderIndex).objectReferenceValue = shader;
                }
                Debug.Log($"[StudioBuild] Retaining runtime UI shader: {shader.name}");
            }

            settings.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
        }

        public static void BuildWeb()
        {
            if (AssetDatabase.LoadAssetAtPath<SceneAsset>(StudioScene) == null)
            {
                throw new InvalidOperationException("Run Studio.Editor.StudioBuild.Configure before building.");
            }

            ConfigureUIShaders();
            string output = Path.GetFullPath("Builds/Web");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { StudioScene },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.Development
            });

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new InvalidOperationException($"Web build failed: {report.summary.result}, errors={report.summary.totalErrors}");
            }
            if (!File.Exists(Path.Combine(output, "index.html")))
            {
                throw new InvalidOperationException("Web build reported success without index.html.");
            }
            Debug.Log($"[StudioBuild] Web build succeeded: bytes={report.summary.totalSize}; output={output}");
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path))
            {
                return;
            }
            string parent = Path.GetDirectoryName(path).Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
    }
}