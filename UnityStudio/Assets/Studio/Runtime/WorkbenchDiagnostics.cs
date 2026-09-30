using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UIElements;

namespace Studio
{
    public sealed class WorkbenchDiagnostics : MonoBehaviour
    {
#if DEVELOPMENT_BUILD || UNITY_EDITOR
        [Serializable]
        private sealed class ElementState
        {
            public string name;
            public string text;
            public bool enabled;
            public Rect bounds;
            public float value;
            public float textWidth;
            public bool numericInput;
            public bool selected;
            public bool tile;
        }

        [Serializable]
        private sealed class WorkbenchState
        {
            public bool ready;
            public bool busy;
            public bool pending;
            public bool saved;
            public int revision;
            public int renderedMeshes;
            public int enabledLegacyCanvases;
            public bool chineseFontReady;
            public string effectiveFont;
            public bool layoutReady;
            public bool meshInView;
            public Bounds meshBounds;
            public int frame;
            public bool focused;
            public string lastPointer;
            public string lastKey;
            public string status;
            public string characterName;
            public string definition;
            public string race;
            public float rotation;
            public Rect viewport;
            public int compatibleItems;
            public int thumbnailCount;
            public float skinTone;
            public int guardedPhysicsSlots;
            public int skippedPhysicsChains;
            public int panelRevision;
            public float scrollY;
            public string pose;
            public bool boneAnimationEnabled;
            public int selectedPose;
            public bool moving;
            public float poseDuration;
            public Vector3 characterPosition;
            public Rect root;
            public Rect camera;
            public List<ElementState> elements = new List<ElementState>();
        }

        private string lastPointer = "";
        private string lastKey = "";

        private void Start()
        {
            var root = GetComponent<UIDocument>().rootVisualElement;
            root.RegisterCallback<PointerDownEvent>(change => lastPointer = $"{change.position} target={((VisualElement)change.target).name}", TrickleDown.TrickleDown);
            root.RegisterCallback<KeyDownEvent>(change => lastKey = change.keyCode.ToString(), TrickleDown.TrickleDown);
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void StudioPublishState(string json);
#endif

        public void Inspect(string unused)
        {
            var session = GetComponent<CharacterSession>();
            var workbench = GetComponent<CharacterWorkbench>();
            var root = GetComponent<UIDocument>().rootVisualElement;
            var title = root.Q<Label>();
            var effectiveFont = title?.resolvedStyle.unityFontDefinition.fontAsset;
            var mesh = session.avatar.GetComponentInChildren<SkinnedMeshRenderer>();
            var state = new WorkbenchState
            {
                ready = session.Ready, busy = session.Busy, pending = session.HasPendingEdits,
                saved = session.HasSavedCharacter, revision = session.Revision,
                status = session.Status, characterName = session.CharacterName,
                race = session.RaceName, rotation = session.avatar.transform.eulerAngles.y,
                skinTone = session.Ready ? session.GetSkinTone() : 0,
                guardedPhysicsSlots = session.GuardedPhysicsSlots, skippedPhysicsChains = session.SkippedPhysicsChains,
                panelRevision = workbench.PanelRevision,
                selectedPose = session.PoseIndex, moving = session.IsMoving,
                poseDuration = session.PoseIndex < session.poseClips.Length && session.poseClips[session.PoseIndex] != null ? session.poseClips[session.PoseIndex].length : 0,
                characterPosition = session.avatar.transform.position,
                scrollY = root.Q<ScrollView>("parameter-scroll")?.scrollOffset.y ?? 0,
                boneAnimationEnabled = session.avatar.umaData != null && session.avatar.umaData.BoneAnimatorsEnabled,
                pose = Hash128.Compute(string.Join(";", session.avatar.GetComponentsInChildren<Transform>()
                    .Select(bone => bone.name + bone.localPosition.ToString("F5") + bone.localRotation.ToString("F5"))) +
                    string.Join(";", session.avatar.GetComponentsInChildren<SkinnedMeshRenderer>()
                        .Where(renderer => renderer.sharedMesh != null).SelectMany(renderer => Enumerable.Range(0, renderer.sharedMesh.blendShapeCount)
                            .Select(index => renderer.GetBlendShapeWeight(index).ToString("F5"))))).ToString(),
                viewport = root.Q("character-viewport") != null && IsFinite(root.Q("character-viewport").worldBound) ? root.Q("character-viewport").worldBound : new Rect(),
                compatibleItems = session.Ready ? session.CompatibleWardrobe().Count() : 0,
                thumbnailCount = root.Query<Image>().ToList().Count(image => image.image != null || image.sprite != null),
                definition = session.CanCommit ? session.avatar.GetAvatarDefinitionString(false, false) : "",
                renderedMeshes = session.avatar.GetComponentsInChildren<SkinnedMeshRenderer>()
                    .Count(renderer => renderer.enabled && renderer.sharedMesh != null && renderer.sharedMesh.vertexCount > 0),
                enabledLegacyCanvases = FindObjectsByType<Canvas>().Count(canvas => canvas.enabled),
                chineseFontReady = effectiveFont != null && effectiveFont.HasCharacter('影', true, true) && effectiveFont.HasCharacter('棚', true, true),
                effectiveFont = effectiveFont == null ? "" : effectiveFont.faceInfo.familyName,
                frame = Time.frameCount, focused = Application.isFocused, lastPointer = lastPointer, lastKey = lastKey,
                layoutReady = IsFinite(root.worldBound),
                meshInView = mesh != null && GeometryUtility.TestPlanesAABB(GeometryUtility.CalculateFrustumPlanes(workbench.studioCamera), mesh.bounds),
                meshBounds = mesh == null ? new Bounds() : mesh.bounds,
                root = IsFinite(root.worldBound) ? root.worldBound : new Rect(), camera = workbench.studioCamera.rect
            };
            root.Query<VisualElement>().ForEach(element =>
            {
                if (!(element is Button) && !(element is Slider) && !(element is TextElement) && !(element is TextField)) return;
                if (!IsFinite(element.worldBound)) return;
                var text = element as TextElement;
                float textWidth = text == null ? 0 : text.MeasureTextSize(text.text, 0, VisualElement.MeasureMode.Undefined,
                    0, VisualElement.MeasureMode.Undefined).x;
                state.elements.Add(new ElementState
                {
                    name = element.name, text = text == null ? "" : text.text,
                    bounds = element.worldBound, enabled = element.enabledInHierarchy,
                    value = element is Slider slider ? slider.value : 0,
                    numericInput = element is Slider numericSlider && numericSlider.showInputField,
                    selected = element.ClassListContains("selected"), tile = element.ClassListContains("choice-tile"),
                    textWidth = float.IsFinite(textWidth) ? textWidth : 0
                });
            });
            string json = JsonUtility.ToJson(state);
#if UNITY_WEBGL && !UNITY_EDITOR
            StudioPublishState(json);
#else
            Debug.Log("[StudioDiagnostics] " + json);
#endif
        }

        private static bool IsFinite(Rect bounds)
        {
            return float.IsFinite(bounds.x) && float.IsFinite(bounds.y) && float.IsFinite(bounds.width) && float.IsFinite(bounds.height);
        }
#endif
    }
}