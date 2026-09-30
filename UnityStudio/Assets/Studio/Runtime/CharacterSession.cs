using System;
using System.Collections.Generic;
using System.Linq;
using UMA;
using UMA.CharacterSystem;
using UnityEngine;

namespace Studio
{
    public sealed class CharacterSession : MonoBehaviour
    {
        private const string StorageKey = "studio.character.v1";
        public DynamicCharacterAvatar avatar;
        public List<string> bodyParameters = new List<string>();
        public List<string> faceParameters = new List<string>();
        public List<string> hairParameters = new List<string>();
        public List<string> legParameters = new List<string>();
        public List<UMAPreset> presets = new List<UMAPreset>();
        public List<UMAWardrobeRecipe> wardrobe = new List<UMAWardrobeRecipe>();
        public List<SharedColorTable> colorTables = new List<SharedColorTable>();
        public string RaceName => avatar.activeRace.name;
        public string[] AvailableRaces => presets.Where(preset => preset != null)
            .Select(preset => preset.Definition.RaceName).Where(name => !string.IsNullOrEmpty(name)).Distinct().ToArray();
        public int AppearanceRevision { get; private set; }
        public RuntimeAnimatorController poseController;
        public AnimationClip[] poseClips = Array.Empty<AnimationClip>();
        public static readonly string[] PoseNames = { "静止", "放松", "平举", "迈步", "待机", "行走", "跑步" };
        public int PoseIndex { get; private set; }
        public bool IsMoving => PoseIndex >= 4 && !StudioPosing;
        public bool StudioPosing { get; private set; }
        public StudioPoseRig StudioPose { get; } = new StudioPoseRig();

        public event Action Changed;
        public bool Ready { get; private set; }
        public bool Busy { get; private set; }
        public bool HasPendingEdits => pendingDna.Count > 0 || pendingSkinTone.HasValue;
        public bool CanCommit => Ready && !Busy && !HasPendingEdits;
        public bool HasSavedCharacter => PlayerPrefs.HasKey(StorageKey);
        public string Status { get; private set; } = "正在生成人物…";
        public string CharacterName { get; set; } = "我的角色";
        public int Revision { get; private set; }

        private readonly Dictionary<string, float> pendingDna = new Dictionary<string, float>();
        private string initialDefinition;
        private string committedDefinition;
        private float applyAfter;
        private float? pendingSkinTone;
        public static readonly Color[] SkinTones =
        {
            new Color32(250, 231, 214, 255), new Color32(230, 190, 157, 255),
            new Color32(201, 150, 112, 255), new Color32(164, 111, 76, 255),
            new Color32(117, 73, 49, 255), new Color32(72, 43, 31, 255)
        };
        private float startedAt;
        private bool recovering;
        private readonly Dictionary<string, string> raceSnapshots = new Dictionary<string, string>();
        private readonly Dictionary<SlotDataAsset, SlotDataAsset> physicsSlots = new Dictionary<SlotDataAsset, SlotDataAsset>();
        private readonly List<StudioSwayBoneAnimator> physicsAdapters = new List<StudioSwayBoneAnimator>();
        public int GuardedPhysicsSlots => physicsSlots.Count;
        public int SkippedPhysicsChains => physicsAdapters.Sum(adapter => adapter.SkippedChains);

        [Serializable]
        private sealed class CharacterRecord
        {
            public int version;
            public string name;
            public string definition;
        }

        private void Awake()
        {
            if (avatar == null)
            {
                Status = "未找到人物，请重新加载页面";
                Changed?.Invoke();
                return;
            }
            avatar.CharacterCreated.AddListener(OnGenerated);
            avatar.CharacterUpdated.AddListener(OnGenerated);
            avatar.CharacterBegun.AddListener(PreparePhysics);
            Busy = true;
            startedAt = Time.unscaledTime;
        }

        private void OnDestroy()
        {
            StudioPose.Dispose();
            if (avatar == null) return;
            avatar.CharacterCreated.RemoveListener(OnGenerated);
            avatar.CharacterUpdated.RemoveListener(OnGenerated);
            avatar.CharacterBegun.RemoveListener(PreparePhysics);
            foreach (var slot in physicsSlots.Values) Destroy(slot);
            foreach (var adapter in physicsAdapters) Destroy(adapter);
        }

        private void PreparePhysics(UMAData data)
        {
            if (data?.umaRecipe?.slotDataList == null) return;
            foreach (var slot in data.umaRecipe.slotDataList)
            {
                if (slot?.asset?.animatedBones == null || physicsSlots.ContainsValue(slot.asset) ||
                    !slot.asset.animatedBones.Any(animator => animator is SwayBoneAnimator)) continue;
                var source = slot.asset;
                if (!physicsSlots.TryGetValue(source, out var local))
                {
                    local = Instantiate(source);
                    local.name = source.name;
                    local.animatedBones = source.animatedBones.Select(animator =>
                    {
                        if (!(animator is SwayBoneAnimator)) return animator;
                        var adapter = ScriptableObject.CreateInstance<StudioSwayBoneAnimator>();
                        JsonUtility.FromJsonOverwrite(JsonUtility.ToJson(animator), adapter);
                        physicsAdapters.Add(adapter);
                        return (BaseUpdatedObject)adapter;
                    }).ToArray();
                    physicsSlots.Add(source, local);
                }
                slot.asset = local;
            }
        }

        private void Update()
        {
            if (avatar == null) return;
            if (Ready && !Busy && IsMoving)
                foreach (var animator in avatar.GetComponentsInChildren<Animator>())
                {
                    var state = animator.GetCurrentAnimatorStateInfo(0);
                    if (!state.loop && state.normalizedTime >= 1)
                        animator.Play("Base Layer.Pose" + PoseIndex, 0, state.normalizedTime % 1);
                }
            if (Busy && Time.unscaledTime - startedAt > 45)
            {
                Busy = false;
                Ready = false;
                Status = "生成超时，请重新加载页面后恢复已保存角色";
                Changed?.Invoke();
                return;
            }
            if (Ready && !Busy && HasPendingEdits && Time.unscaledTime >= applyAfter)
            {
                var values = new Dictionary<string, float>(pendingDna);
                float? skinTone = pendingSkinTone;
                pendingSkinTone = null;
                pendingDna.Clear();
                Apply(() =>
                {
                    foreach (var value in values) avatar.SetDNA(value.Key, value.Value, false);
                    if (skinTone.HasValue) ApplySkinTone(skinTone.Value);
                    avatar.ForceUpdate(true, true, true);
                });
            }
        }

        private void OnGenerated(UMAData data)
        {
            if (data == null || data.umaRecipe == null) return;
            try
            {
                data.SetBoneAnimatorsEnabled(false);
                ApplyPose();
                if (StudioPosing) StudioPose.Bind(avatar.GetComponentInChildren<Animator>());
                foreach (var expression in avatar.GetComponentsInChildren<UMA.PoseTools.ExpressionPlayer>())
                    expression.enabled = false;
                foreach (var expression in avatar.GetComponentsInChildren<DynamicExpressionPlayer>())
                    expression.enabled = false;
                committedDefinition = avatar.GetAvatarDefinitionString(false, false);
                if (initialDefinition == null) initialDefinition = committedDefinition;
                Busy = false;
                Ready = true;
                Revision++;
                Status = recovering ? "已恢复上一次可用人物" : "人物已就绪";
                recovering = false;
                Debug.Log($"[StudioCharacter] ready revision={Revision} parameters={avatar.GetDNA().Count}");
                Changed?.Invoke();
            }
            catch (Exception exception)
            {
                Fail(exception);
            }
        }

        public void SelectPose(int index)
        {
            if (StudioPosing || !CanCommit || index < 0 || index >= PoseNames.Length || index == PoseIndex ||
                poseController == null || index >= poseClips.Length || poseClips[index] == null) return;
            PoseIndex = index;
            ApplyPose();
            Changed?.Invoke();
        }

        public void BeginStudioPose()
        {
            if (!CanCommit || StudioPosing) return;
            PoseIndex = 0;
            ApplyPose();
            StudioPose.Bind(avatar.GetComponentInChildren<Animator>());
            StudioPosing = true;
            Changed?.Invoke();
        }

        public void EndStudioPose()
        {
            if (!StudioPosing) return;
            StudioPose.Release();
            StudioPosing = false;
            ApplyPose();
            Changed?.Invoke();
        }

        private void ApplyPose()
        {
            foreach (var animator in avatar.GetComponentsInChildren<Animator>())
            {
                animator.enabled = true;
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                animator.speed = IsMoving ? 1 : 0;
                if (poseController != null) animator.runtimeAnimatorController = poseController;
                if (animator.runtimeAnimatorController == null) continue;
                if (poseController != null) animator.Play("Base Layer.Pose" + PoseIndex, 0, PoseIndex == 3 ? 0.25f : 0);
                else animator.Play(0, 0, 0);
                animator.Update(0);
            }
        }

        public Dictionary<string, float> GetValues()
        {
            if (!Ready) return new Dictionary<string, float>();
            return avatar.GetDNA().ToDictionary(entry => entry.Key, entry => entry.Value.Value);
        }

        public void QueueDna(string parameter, float value)
        {
            if (!Ready || !float.IsFinite(value) || !avatar.GetDNA().ContainsKey(parameter)) return;
            pendingDna[parameter] = Mathf.Clamp01(value);
            applyAfter = Time.unscaledTime + 0.2f;
            Status = "等待应用调整…";
            Changed?.Invoke();
        }

        public void Randomize(IEnumerable<string> parameters)
        {
            if (!CanCommit) return;
            var values = GetValues();
            foreach (string parameter in parameters.Distinct())
            {
                if (values.ContainsKey(parameter)) QueueDna(parameter, UnityEngine.Random.Range(0.35f, 0.65f));
            }
        }

        public static Color EvaluateSkinTone(float value)
        {
            float scaled = Mathf.Clamp01(value) * (SkinTones.Length - 1);
            int index = Mathf.Min(Mathf.FloorToInt(scaled), SkinTones.Length - 2);
            return Color.Lerp(SkinTones[index], SkinTones[index + 1], scaled - index);
        }

        public float GetSkinTone()
        {
            if (pendingSkinTone.HasValue) return pendingSkinTone.Value;
            if (!avatar.characterColors.GetColor("Skin", out OverlayColorData skin)) return 0.3f;
            Color color = skin.PropertyBlock?.GetProperty<UMAColorProperty>("_Base_Color")?.Value ?? skin.color;
            float best = 0;
            float distance = float.MaxValue;
            for (int index = 0; index < SkinTones.Length - 1; index++)
            {
                Vector3 start = new Vector3(SkinTones[index].r, SkinTones[index].g, SkinTones[index].b);
                Vector3 direction = new Vector3(SkinTones[index + 1].r, SkinTones[index + 1].g, SkinTones[index + 1].b) - start;
                Vector3 delta = new Vector3(color.r, color.g, color.b) - start;
                float fraction = Mathf.Clamp01(Vector3.Dot(delta, direction) / direction.sqrMagnitude);
                float error = (delta - direction * fraction).sqrMagnitude;
                if (error < distance) { distance = error; best = (index + fraction) / (SkinTones.Length - 1); }
            }
            return best;
        }

        public void QueueSkinTone(float value)
        {
            if (!Ready || !float.IsFinite(value)) return;
            pendingSkinTone = Mathf.Clamp01(value);
            applyAfter = Time.unscaledTime + 0.2f;
            Status = "等待应用肤色…";
            Changed?.Invoke();
        }

        private void ApplySkinTone(float value)
        {
            if (!avatar.characterColors.GetColor("Skin", out OverlayColorData current)) throw new InvalidOperationException("Skin color is unavailable.");
            OverlayColorData skin = current.Clone();
            skin.PropertyBlock ??= new UMAMaterialPropertyBlock();
            var property = skin.PropertyBlock.GetProperty<UMAColorProperty>("_Base_Color");
            if (property == null)
            {
                property = new UMAColorProperty { name = "_Base_Color" };
                skin.PropertyBlock.shaderProperties.Add(property);
            }
            property.Value = EvaluateSkinTone(value);
            skin.displayColor = property.Value;
            avatar.SetRawColor("Skin", skin, false);
        }

        public void ResetCharacter()
        {
            if (!CanCommit || initialDefinition == null) return;
            RestoreDefinition(initialDefinition);
        }

        public IEnumerable<UMAWardrobeRecipe> CompatibleWardrobe()
        {
            var races = avatar.activeRace.data.GetCrossCompatibleRaces().ToList();
            races.Add(RaceName);
            return wardrobe.Where(item => item != null && item.compatibleRaces.Any(races.Contains)).Distinct();
        }

        public void ChangeGender(string race)
        {
            if (!CanCommit || race == RaceName || !AvailableRaces.Contains(race)) return;
            raceSnapshots[RaceName] = committedDefinition;
            if (raceSnapshots.TryGetValue(race, out string definition)) RestoreDefinition(definition);
            else ApplyPreset(presets.First(preset => preset.Definition.RaceName == race));
        }

        public void ApplyPreset(UMAPreset preset)
        {
            if (!CanCommit || preset == null || !presets.Contains(preset)) return;
            AppearanceRevision++;
            Apply(() => preset.ApplyTo(avatar));
        }

        public Dictionary<string, float> RegionValues(UMAPreset preset, IEnumerable<string> parameters)
        {
            var supported = avatar.GetDNA();
            var source = (preset.Definition.Dna ?? Array.Empty<DnaDef>()).ToDictionary(value => value.Name, value => value.Value);
            return parameters.Distinct().Where(supported.ContainsKey).ToDictionary(name => name,
                name => source.TryGetValue(name, out float value) ? value : 0.5f);
        }

        public void ApplyRegionPreset(UMAPreset preset, IEnumerable<string> parameters)
        {
            if (!CanCommit || preset == null || !presets.Contains(preset) || preset.Definition.RaceName != RaceName) return;
            var values = RegionValues(preset, parameters);
            if (values.Count == 0) return;
            Apply(() =>
            {
                foreach (var value in values) avatar.SetDNA(value.Key, value.Value, false);
                avatar.ForceUpdate(true, true, true);
            });
        }

        public void Wear(UMAWardrobeRecipe item)
        {
            if (!CanCommit || !CompatibleWardrobe().Contains(item)) return;
            AppearanceRevision++;
            Apply(() => { avatar.SetSlot(item); avatar.BuildCharacter(true); });
        }

        public void RemoveSlot(string slot)
        {
            if (!CanCommit) return;
            AppearanceRevision++;
            Apply(() => { avatar.ClearSlot(slot); avatar.BuildCharacter(true); });
        }

        public void ChangeColor(string name, OverlayColorData color)
        {
            if (!CanCommit || color == null) return;
            AppearanceRevision++;
            Apply(() => avatar.SetRawColor(name, color.Clone(), true));
        }

        public void SaveCharacter()
        {
            if (!CanCommit) return;
            try
            {
                string name = CharacterName.Trim();
                if (name.Length == 0 || name.Length > 40) throw new ArgumentException("角色名称需为 1 至 40 个字符");
                var record = new CharacterRecord { version = 1, name = name, definition = committedDefinition };
                string json = JsonUtility.ToJson(record);
                if (json.Length > 250000) throw new InvalidOperationException("角色数据过大，未覆盖原存档");
                PlayerPrefs.SetString(StorageKey, json);
                PlayerPrefs.Save();
                Status = "已保存到本浏览器";
                Debug.Log($"[StudioCharacter] saved revision={Revision}");
            }
            catch (Exception)
            {
                Status = "保存失败，请检查名称或浏览器存储空间";
            }
            Changed?.Invoke();
        }

        public void LoadCharacter()
        {
            if (!CanCommit || !HasSavedCharacter) return;
            try
            {
                string json = PlayerPrefs.GetString(StorageKey);
                if (json.Length > 250000) throw new InvalidOperationException();
                var record = JsonUtility.FromJson<CharacterRecord>(json);
                if (record == null || record.version != 1 || string.IsNullOrWhiteSpace(record.name) ||
                    record.name.Length > 40 || string.IsNullOrEmpty(record.definition)) throw new InvalidOperationException();
                var definition = JsonUtility.FromJson<AvatarDefinition>(record.definition);
                if ((!AvailableRaces.Contains(definition.RaceName) && definition.RaceName != RaceName) || definition.Colors == null || definition.Wardrobe == null ||
                    definition.Dna == null || definition.Dna.Length == 0 ||
                    definition.Dna.Any(value => string.IsNullOrEmpty(value.Name) || value.val < 0 || value.val > 10000) ||
                    definition.Dna.Select(value => value.Name).Distinct().Count() != definition.Dna.Length)
                    throw new InvalidOperationException();
                CharacterName = record.name;
                RestoreDefinition(record.definition);
            }
            catch (Exception)
            {
                Status = "无法恢复此存档，当前人物保持不变";
                Changed?.Invoke();
            }
        }

        private void RestoreDefinition(string definition)
        {
            AppearanceRevision++;
            Apply(() =>
            {
                avatar.characterColors.Colors.Clear();
                avatar.LoadAvatarDefinition(definition, ResetColors: false);
                avatar.BuildCharacter(false);
            });
        }

        private void Apply(Action operation)
        {
            Busy = true;
            startedAt = Time.unscaledTime;
            Status = "正在应用人物调整…";
            Changed?.Invoke();
            try { operation(); }
            catch (Exception exception) { Fail(exception); }
        }

        private void Fail(Exception exception)
        {
            Debug.LogError($"[StudioCharacter] {exception.GetType().Name}: {exception.Message}");
            pendingDna.Clear();
            pendingSkinTone = null;
            if (!recovering && committedDefinition != null)
            {
                recovering = true;
                RestoreDefinition(committedDefinition);
                return;
            }
            Busy = false;
            Ready = false;
            Status = "人物恢复失败，请重新加载页面";
            Changed?.Invoke();
        }
    }
}