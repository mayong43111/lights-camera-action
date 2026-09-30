using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace Studio
{
    public sealed class PhotoStudioPage : IDisposable
    {
        public VisualElement View { get; }
        public VisualElement Viewport { get; }
        public bool Active { get; private set; }
        public int Framing { get; private set; }
        public float OrbitYaw { get; private set; }
        public PhotoStudioSet Set { get; }
        private readonly CharacterSession session;
        private readonly Camera camera;
        private readonly Label actorName;
        private readonly DropdownField pose;
        private readonly Slider lens;
        private readonly Slider[] poseSliders = new Slider[StudioPoseRig.Channels.Length];
        private readonly Button[] frames = new Button[3];
        private Vector3 savedPosition;
        private Quaternion savedRotation;
        private float savedFov;
        private Rect savedRect;
        private float pitch;
        private float zoom = 1;
        private int pointer = -1;
        private Vector2 previousPointer;

        public PhotoStudioPage(CharacterSession session, Camera camera, Material backdropMaterial, Action returnToCreator)
        {
            this.session = session;
            this.camera = camera;
            Set = new PhotoStudioSet(session.avatar.transform, camera, backdropMaterial);
            View = new VisualElement { name = "photography-page" };
            View.AddToClassList("photography-page");
            View.style.display = DisplayStyle.None;
            var panel = new ScrollView { name = "photo-controls" };
            panel.AddToClassList("photo-controls");
            View.Add(panel);
            var title = new Label("摄影棚");
            title.AddToClassList("section-heading");
            panel.Add(title);
            panel.Add(new Button(returnToCreator) { name = "return-creator", text = "编辑人物" });
            actorName = new Label { name = "photo-actor-name" };
            actorName.AddToClassList("caption");
            panel.Add(actorName);
            pose = new DropdownField("姿势", new System.Collections.Generic.List<string>(StudioPoseRig.Names), 0) { name = "photo-pose" };
            pose.RegisterValueChangedCallback(change => { session.StudioPose.SelectPreset(pose.index); RefreshPose(); });
            panel.Add(pose);
            var poseTools = new VisualElement();
            poseTools.AddToClassList("photo-segments");
            poseTools.Add(new Button(() => { session.StudioPose.Mirror(); RefreshPose(); }) { name = "photo-mirror", text = "镜像姿势" });
            poseTools.Add(new Button(() => { session.StudioPose.SelectPreset(pose.index); RefreshPose(); }) { name = "photo-reset-pose", text = "重置姿势" });
            panel.Add(poseTools);
            var part = new DropdownField("调整部位", new System.Collections.Generic.List<string>(StudioPoseRig.Groups), 0) { name = "photo-pose-part" };
            panel.Add(part);
            for (int index = 0; index < poseSliders.Length; index++)
            {
                int channel = index;
                var slider = new Slider(StudioPoseRig.Labels[index], -1, 1) { name = "photo-muscle-" + index };
                slider.AddToClassList("dna-slider");
                slider.style.display = StudioPoseRig.GroupOf(index) == 0 ? DisplayStyle.Flex : DisplayStyle.None;
                slider.RegisterValueChangedCallback(change => { session.StudioPose.Adjust(channel, change.newValue); RefreshPose(); });
                poseSliders[index] = slider;
                panel.Add(slider);
            }
            part.RegisterValueChangedCallback(change =>
            {
                for (int index = 0; index < poseSliders.Length; index++)
                    poseSliders[index].style.display = StudioPoseRig.GroupOf(index) == part.index ? DisplayStyle.Flex : DisplayStyle.None;
            });
            panel.Add(new Label("取景") { name = "photo-frame-label" });
            var frameBar = new VisualElement();
            frameBar.AddToClassList("photo-segments");
            panel.Add(frameBar);
            string[] names = { "全身", "半身", "特写" };
            for (int index = 0; index < names.Length; index++)
            {
                int selected = index;
                frames[index] = new Button(() => { Framing = selected; zoom = 1; UpdateCamera(); Refresh(); })
                    { name = "photo-frame-" + index, text = names[index] };
                frameBar.Add(frames[index]);
            }
            lens = new Slider("镜头视角", 25, 70) { name = "photo-lens", value = 40 };
            lens.AddToClassList("dna-slider");
            lens.RegisterValueChangedCallback(change => { if (Active) { camera.fieldOfView = change.newValue; UpdateCamera(); } });
            panel.Add(lens);
            panel.Add(new Button(() => { OrbitYaw = 0; pitch = 0; zoom = 1; lens.value = 40; UpdateCamera(); })
                { name = "photo-reset-camera", text = "重置视角" });
            string[] lightNames = { "主光", "补光", "轮廓光" };
            for (int index = 0; index < lightNames.Length; index++)
            {
                int selected = index;
                var light = new Slider(lightNames[index], 0, PhotoStudioSet.MaxIntensity) { name = "photo-light-" + index, value = Set.Intensities[index] };
                light.AddToClassList("dna-slider");
                light.RegisterValueChangedCallback(change => Set.SetIntensity(selected, change.newValue));
                panel.Add(light);
            }
            panel.Add(new Label("背景"));
            var backgrounds = new VisualElement();
            backgrounds.AddToClassList("swatch-grid");
            panel.Add(backgrounds);
            string[] backgroundNames = { "浅灰", "深灰", "薄荷绿" };
            var swatches = new Button[PhotoStudioSet.Backgrounds.Length];
            for (int index = 0; index < swatches.Length; index++)
            {
                int selected = index;
                var button = new Button(() =>
                {
                    Set.SetBackground(selected);
                    for (int choice = 0; choice < swatches.Length; choice++) swatches[choice].EnableInClassList("selected", choice == selected);
                }) { name = "photo-backdrop-" + index, tooltip = backgroundNames[index] };
                button.AddToClassList("swatch");
                button.style.backgroundColor = PhotoStudioSet.Backgrounds[index];
                button.EnableInClassList("selected", index == 0);
                swatches[index] = button;
                backgrounds.Add(button);
            }
            Viewport = new VisualElement { name = "photo-viewport" };
            Viewport.AddToClassList("photo-viewport");
            View.Add(Viewport);
            Viewport.RegisterCallback<GeometryChangedEvent>(change => ResizeCamera());
            Viewport.RegisterCallback<PointerDownEvent>(change =>
            {
                if (!Active || change.button != 0 || change.target != Viewport || !session.CanCommit) return;
                pointer = change.pointerId;
                previousPointer = change.position;
                Viewport.CapturePointer(pointer);
                change.StopPropagation();
            });
            Viewport.RegisterCallback<PointerMoveEvent>(change =>
            {
                if (pointer != change.pointerId || !Viewport.HasPointerCapture(pointer)) return;
                Vector2 delta = (Vector2)change.position - previousPointer;
                OrbitYaw = Mathf.Clamp(OrbitYaw - delta.x * 0.3f, -80, 80);
                pitch = Mathf.Clamp(pitch + delta.y * 0.2f, -15, 35);
                previousPointer = change.position;
                UpdateCamera();
            });
            Viewport.RegisterCallback<PointerUpEvent>(change => ReleasePointer());
            Viewport.RegisterCallback<PointerCancelEvent>(change => ReleasePointer());
            Viewport.RegisterCallback<PointerCaptureOutEvent>(change => pointer = -1);
            Viewport.RegisterCallback<WheelEvent>(change =>
            {
                zoom = Mathf.Clamp(zoom * Mathf.Exp(change.delta.y * 0.025f), 0.65f, 2.5f);
                UpdateCamera();
                change.StopPropagation();
            });
        }

        public void Enter()
        {
            if (Active) return;
            session.BeginStudioPose();
            savedPosition = camera.transform.position;
            savedRotation = camera.transform.rotation;
            savedFov = camera.fieldOfView;
            savedRect = camera.rect;
            Set.Enter();
            Active = true;
            View.style.display = DisplayStyle.Flex;
            camera.fieldOfView = lens.value;
            Refresh();
        }

        public void Exit()
        {
            if (!Active) return;
            ReleasePointer();
            Set.Exit();
            Active = false;
            View.style.display = DisplayStyle.None;
            session.EndStudioPose();
            camera.transform.SetPositionAndRotation(savedPosition, savedRotation);
            camera.fieldOfView = savedFov;
            camera.rect = savedRect;
        }

        public void Refresh()
        {
            actorName.text = session.CharacterName;
            pose.SetEnabled(session.CanCommit);
            pose.SetValueWithoutNotify(StudioPoseRig.Names[session.StudioPose.PresetIndex]);
            for (int index = 0; index < frames.Length; index++) frames[index].EnableInClassList("selected", index == Framing);
            RefreshPose();
        }

        private void RefreshPose()
        {
            for (int index = 0; index < poseSliders.Length; index++)
                poseSliders[index].SetValueWithoutNotify(session.StudioPose.Values[index]);
            if (!Active || !session.StudioPose.Bound) return;
            Set.AlignSubject(session.StudioPose.Bounds);
            UpdateCamera();
        }

        public void ResizeCamera()
        {
            if (!Active || View.worldBound.width <= 0 || View.worldBound.height <= 0) return;
            Rect bounds = Viewport.worldBound;
            if (bounds.width <= 0 || bounds.height <= 0) return;
            camera.rect = new Rect(bounds.x / View.worldBound.width, 1 - bounds.yMax / View.worldBound.height,
                bounds.width / View.worldBound.width, bounds.height / View.worldBound.height);
            UpdateCamera();
        }

        private void UpdateCamera()
        {
            if (!Active || !session.Ready || camera.aspect <= 0) return;
            var renderer = session.avatar.GetComponentInChildren<SkinnedMeshRenderer>();
            if (renderer == null) return;
            Bounds bounds = session.StudioPose.Bound ? session.StudioPose.Bounds : renderer.bounds;
            if (Framing > 0)
            {
                var head = session.avatar.umaData.skeleton.GetBoneTransform("Head");
                if (head != null) bounds = new Bounds(head.position + Vector3.up * (Framing == 1 ? -0.25f : 0.04f),
                    Vector3.one * (Framing == 1 ? 1.1f : 0.55f));
            }
            Quaternion rotation = Quaternion.AngleAxis(OrbitYaw, Vector3.up) * savedRotation * Quaternion.Euler(pitch, 0, 0);
            float tangent = Mathf.Tan(camera.fieldOfView * Mathf.Deg2Rad * 0.5f);
            float distance = (Mathf.Max(bounds.extents.y / tangent, bounds.extents.x / (tangent * camera.aspect)) + bounds.extents.z) * 1.15f * zoom;
            camera.transform.SetPositionAndRotation(bounds.center - rotation * Vector3.forward * distance, rotation);
        }

        private void ReleasePointer()
        {
            if (pointer < 0) return;
            Viewport.ReleasePointer(pointer);
            pointer = -1;
        }

        public void Dispose() { Exit(); Set.Dispose(); }
    }
}