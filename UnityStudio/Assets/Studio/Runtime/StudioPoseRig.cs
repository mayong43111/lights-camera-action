using System;
using System.Linq;
using UnityEngine;

namespace Studio
{
    public sealed class StudioPoseRig : IDisposable
    {
        public static readonly string[] Names = { "静止", "瑜伽山式", "瑜伽上举", "瑜伽幻椅", "瑜伽战士一式", "瑜伽树式", "芭蕾燕式", "芭蕾二位" };
        public static readonly string[] Groups = { "躯干", "头颈", "左臂", "右臂", "左腿", "右腿" };
        public static readonly string[] Channels = {
            "Spine Front-Back", "Spine Left-Right", "Spine Twist Left-Right",
            "Head Nod Down-Up", "Head Tilt Left-Right", "Head Turn Left-Right",
            "Left Arm Down-Up", "Left Arm Front-Back", "Left Arm Twist In-Out", "Left Forearm Stretch", "Left Forearm Twist In-Out", "Left Hand Down-Up", "Left Hand In-Out",
            "Right Arm Down-Up", "Right Arm Front-Back", "Right Arm Twist In-Out", "Right Forearm Stretch", "Right Forearm Twist In-Out", "Right Hand Down-Up", "Right Hand In-Out",
            "Left Upper Leg Front-Back", "Left Upper Leg In-Out", "Left Upper Leg Twist In-Out", "Left Lower Leg Stretch", "Left Lower Leg Twist In-Out", "Left Foot Up-Down",
            "Right Upper Leg Front-Back", "Right Upper Leg In-Out", "Right Upper Leg Twist In-Out", "Right Lower Leg Stretch", "Right Lower Leg Twist In-Out", "Right Foot Up-Down"
        };
        public static readonly string[] Labels = {
            "前后俯仰", "左右侧弯", "躯干扭转", "抬头低头", "左右侧倾", "转头",
            "上臂抬落", "上臂前后", "上臂旋转", "肘部伸屈", "前臂旋转", "手腕俯仰", "手腕侧偏",
            "上臂抬落", "上臂前后", "上臂旋转", "肘部伸屈", "前臂旋转", "手腕俯仰", "手腕侧偏",
            "大腿前后", "大腿开合", "大腿旋转", "膝部伸屈", "小腿旋转", "脚尖勾绷",
            "大腿前后", "大腿开合", "大腿旋转", "膝部伸屈", "小腿旋转", "脚尖勾绷"
        };
        public static int GroupOf(int channel) => channel < 3 ? 0 : channel < 6 ? 1 : channel < 13 ? 2 : channel < 20 ? 3 : channel < 26 ? 4 : 5;
        public int PresetIndex { get; private set; }
        public bool Bound => handler != null;
        public Bounds Bounds { get; private set; }
        public float[] Values { get; } = new float[Channels.Length];
        private readonly int[] muscleIndices = Channels.Select(name => Array.IndexOf(HumanTrait.MuscleName, name)).ToArray();
        private HumanPoseHandler handler;
        private Animator animator;
        private HumanPose pose;
        private float[] standing;
        private float[] neutral;
        private float[] selectedMuscles;
        private bool initialized;
        private SkinnedMeshRenderer[] renderers;
        private Bounds[] originalBounds;
        private Mesh baked;

        public void Bind(Animator target)
        {
            Release();
            if (target == null || !target.isHuman || target.avatar == null || !target.avatar.isValid)
                throw new InvalidOperationException("Studio posing requires a valid Humanoid avatar.");
            if (muscleIndices.Any(index => index < 0)) throw new InvalidOperationException("Unsupported Humanoid muscle channel.");
            animator = target;
            handler = new HumanPoseHandler(target.avatar, target.transform);
            handler.GetHumanPose(ref pose);
            standing = (float[])pose.muscles.Clone();
            target.Play("Base Layer.Pose2", 0, 0);
            target.Update(0);
            var reference = new HumanPose();
            handler.GetHumanPose(ref reference);
            neutral = (float[])reference.muscles.Clone();
            animator.enabled = false;
            renderers = target.GetComponentsInChildren<SkinnedMeshRenderer>();
            originalBounds = renderers.Select(renderer => renderer.localBounds).ToArray();
            baked = new Mesh { name = "Studio Pose Bounds" };
            if (!initialized) SelectPreset(0);
            else
            {
                pose.muscles = (float[])selectedMuscles.Clone();
                Apply();
            }
        }

        public void SelectPreset(int index)
        {
            if (!Bound || index < 0 || index >= Names.Length) return;
            PresetIndex = index;
            BuildPreset();
            initialized = true;
            SyncValues();
            Apply();
        }

        private void BuildPreset()
        {
            pose.muscles = (float[])(PresetIndex == 0 ? standing : neutral).Clone();
            if (PresetIndex == 0) return;
            Set("Left Forearm Stretch", 1); Set("Right Forearm Stretch", 1);
            Set("Left Lower Leg Stretch", 1); Set("Right Lower Leg Stretch", 1);
            Set("Left Arm Down-Up", -0.9f); Set("Right Arm Down-Up", -0.9f);
            if (PresetIndex >= 2 && PresetIndex <= 5)
            {
                Set("Left Arm Down-Up", 0.9f); Set("Right Arm Down-Up", 0.9f);
                Set("Left Forearm Stretch", 0.9f); Set("Right Forearm Stretch", 0.9f);
            }
            if (PresetIndex == 3)
            {
                Set("Spine Front-Back", 0.3f);
                Set("Left Upper Leg Front-Back", 0.65f); Set("Right Upper Leg Front-Back", 0.65f);
                Set("Left Lower Leg Stretch", -0.2f); Set("Right Lower Leg Stretch", -0.2f);
                Set("Left Foot Up-Down", 0.3f); Set("Right Foot Up-Down", 0.3f);
            }
            if (PresetIndex == 4)
            {
                Set("Left Upper Leg Front-Back", 0.65f); Set("Left Lower Leg Stretch", 0);
                Set("Right Upper Leg Front-Back", -0.6f); Set("Right Foot Up-Down", -0.4f);
            }
            if (PresetIndex == 5)
            {
                Set("Left Upper Leg Front-Back", 0.55f); Set("Left Upper Leg In-Out", 0.65f);
                Set("Left Upper Leg Twist In-Out", 0.45f); Set("Left Lower Leg Stretch", -0.85f);
            }
            if (PresetIndex == 6)
            {
                Set("Spine Front-Back", 0.35f); Set("Head Nod Down-Up", 0.25f);
                Set("Left Arm Down-Up", 0.1f); Set("Left Arm Front-Back", 0.7f);
                Set("Right Arm Down-Up", 0.1f); Set("Right Arm Front-Back", -0.25f);
                Set("Right Upper Leg Front-Back", -0.9f); Set("Right Foot Up-Down", -0.8f);
                Set("Left Hand Down-Up", -0.2f); Set("Right Hand Down-Up", -0.2f);
            }
            if (PresetIndex == 7)
            {
                Set("Left Arm Down-Up", -0.05f); Set("Right Arm Down-Up", -0.05f);
                Set("Left Forearm Stretch", 0.65f); Set("Right Forearm Stretch", 0.65f);
                Set("Left Upper Leg In-Out", 0.3f); Set("Right Upper Leg In-Out", 0.3f);
                Set("Left Upper Leg Twist In-Out", 0.65f); Set("Right Upper Leg Twist In-Out", 0.65f);
                Set("Left Hand Down-Up", -0.2f); Set("Right Hand Down-Up", -0.2f);
            }
        }

        private void Set(string name, float value) => pose.muscles[Array.IndexOf(HumanTrait.MuscleName, name)] = value;
        private void SyncValues()
        {
            for (int index = 0; index < Values.Length; index++) Values[index] = pose.muscles[muscleIndices[index]];
        }

        public void Adjust(int index, float value)
        {
            if (!Bound || index < 0 || index >= Values.Length || !float.IsFinite(value)) return;
            Values[index] = Mathf.Clamp(value, -1, 1);
            pose.muscles[muscleIndices[index]] = Values[index];
            Apply();
        }

        public void Mirror()
        {
            if (!Bound) return;
            var original = (float[])pose.muscles.Clone();
            string[] names = HumanTrait.MuscleName;
            for (int index = 0; index < names.Length; index++)
            {
                string name = names[index];
                string opposite = name.StartsWith("Left ") ? "Right " + name.Substring(5) : name.StartsWith("Right ") ? "Left " + name.Substring(6) : name;
                int other = Array.IndexOf(names, opposite);
                pose.muscles[index] = original[other];
                if (name == opposite && name.Contains("Left-Right")) pose.muscles[index] *= -1;
            }
            SyncValues();
            Apply();
        }

        private void Apply()
        {
            selectedMuscles = (float[])pose.muscles.Clone();
            handler.SetHumanPose(ref pose);
            bool first = true;
            Bounds total = new Bounds();
            foreach (var renderer in renderers)
            {
                if (!renderer.enabled || renderer.sharedMesh == null) continue;
                renderer.BakeMesh(baked);
                baked.RecalculateBounds();
                renderer.localBounds = baked.bounds;
                if (first) { total = renderer.bounds; first = false; }
                else total.Encapsulate(renderer.bounds);
            }
            Bounds = total;
        }

        public void Release()
        {
            if (renderers != null)
                for (int index = 0; index < renderers.Length; index++)
                    if (renderers[index] != null) renderers[index].localBounds = originalBounds[index];
            renderers = null;
            handler?.Dispose();
            handler = null;
            if (animator != null) animator.enabled = true;
            animator = null;
            if (baked != null) UnityEngine.Object.Destroy(baked);
        }
        public void Dispose() => Release();
    }
}