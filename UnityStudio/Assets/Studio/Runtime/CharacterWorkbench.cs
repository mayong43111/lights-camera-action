using System;
using System.Collections.Generic;
using System.Linq;
using UMA;
using UMA.CharacterSystem;
using UnityEngine;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;

namespace Studio
{
    [RequireComponent(typeof(UIDocument))]
    public sealed class CharacterWorkbench : MonoBehaviour
    {
        public CharacterSession session;
        public Camera studioCamera;
        public FontAsset chineseFont;
        public StyleSheet styleSheet;

        private VisualElement root;
        private VisualElement viewport;
        private VisualElement sliders;
        private Label status;
        private TextField characterName;
        private Button save;
        private Button restore;
        private Button reset;
        private Button randomize;
        private readonly List<Button> tabs = new List<Button>();
        private readonly Dictionary<string, Slider> fields = new Dictionary<string, Slider>();
        private readonly List<Button> choices = new List<Button>();
        private readonly List<Button> poseButtons = new List<Button>();
        private int framedPose = -1;
        private readonly Dictionary<Button, Func<bool>> selections = new Dictionary<Button, Func<bool>>();
        public int PanelRevision { get; private set; }
        private VisualElement subcategories;
        private Label stepTitle;
        private Button previous;
        private Button next;
        private ScrollView scroll;
        private string subcategory = "";
        private string displayedRace;
        private Slider skinTone;
        private Texture2D skinRamp;
        private int category;
        private bool populated;
        private int dragPointer = -1;
        private Vector2 dragPosition;

        private static readonly string[] CategoryNames = { "基础", "体型", "五官", "发型", "穿搭" };
        private static readonly string[][] Sections =
        {
            new[] { "性别与预设", "肤色" },
            new[] { "整体", "躯干", "手臂", "腿脚" },
            new[] { "脸型", "眼睛", "眉毛", "鼻子", "嘴唇", "下颌", "耳朵", "妆容" },
            new[] { "发型", "发色", "胡须" },
            new[] { "上装", "下装", "鞋履", "上身内搭", "下身内搭" }
        };
        private static readonly Dictionary<string, string> Words = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "height", "身高" }, { "weight", "体重" }, { "mass", "体量" }, { "muscle", "肌肉" },
            { "body", "身体" }, { "head", "头部" }, { "face", "面部" }, { "size", "大小" },
            { "width", "宽度" }, { "length", "长度" }, { "depth", "深度" }, { "position", "位置" },
            { "upper", "上部" }, { "lower", "下部" }, { "arm", "手臂" }, { "arms", "手臂" },
            { "forearm", "前臂" }, { "hand", "手掌" }, { "hands", "手掌" }, { "leg", "腿部" },
            { "legs", "腿部" }, { "feet", "脚部" }, { "foot", "脚部" }, { "belly", "腹部" },
            { "waist", "腰部" }, { "hip", "髋部" }, { "hips", "髋部" }, { "breast", "胸部" },
            { "breasts", "胸部" }, { "chest", "胸部" }, { "gluteus", "臀部" }, { "butt", "臀部" },
            { "shoulder", "肩部" }, { "shoulders", "肩部" }, { "neck", "颈部" }, { "hair", "头发" },
            { "eye", "眼睛" }, { "eyes", "眼睛" }, { "eyebrow", "眉毛" }, { "eyebrows", "眉毛" },
            { "brow", "眉部" }, { "eyelid", "眼睑" }, { "nose", "鼻部" }, { "nostril", "鼻翼" },
            { "nostrils", "鼻翼" }, { "mouth", "嘴部" }, { "lip", "嘴唇" }, { "lips", "嘴唇" },
            { "jaw", "下颌" }, { "chin", "下巴" }, { "cheek", "脸颊" }, { "cheekbone", "颧骨" },
            { "cheeks", "脸颊" }, { "ear", "耳朵" }, { "ears", "耳朵" }, { "forehead", "额头" },
            { "tip", "尖端" }, { "bridge", "鼻梁" }, { "angle", "角度" }, { "rotation", "旋转" },
            { "spacing", "间距" }, { "distance", "距离" }, { "separation", "间距" }, { "roundness", "圆润度" },
            { "thickness", "厚度" }, { "fullness", "饱满度" }, { "protrusion", "突出度" },
            { "in", "内收" }, { "out", "外扩" }, { "up", "上移" }, { "down", "下移" },
            { "forward", "前移" }, { "back", "后移" }, { "left", "左侧" }, { "right", "右侧" },
            { "crease", "褶皱" }, { "curve", "弯曲" }, { "flatten", "扁平度" }, { "shape", "形状" },
            { "scale", "缩放" }, { "lengthen", "延长" }, { "shorten", "缩短" }, { "offset", "偏移" },
            { "cleavage", "间距" }, { "fitness", "紧实度" }, { "orientation", "朝向" },
            { "pitch", "俯仰" }, { "yaw", "偏转" }, { "inclination", "倾斜" }, { "pronounced", "突出度" },
            { "mandible", "下颌骨" }, { "jaws", "下颌" }, { "low", "下部" }, { "elf", "尖" },
            { "broken", "偏曲" }, { "seperation", "间距" }, { "highheels", "踮脚高度" }
        };

        private void OnEnable()
        {
            root = GetComponent<UIDocument>().rootVisualElement;
            root.Clear();
            root.name = "character-workbench";
            root.AddToClassList("workbench");
            root.styleSheets.Add(styleSheet);
            root.style.unityFontDefinition = FontDefinition.FromSDFFont(chineseFont);
            var workspace = Add(root, "workspace");
            var panel = Add(workspace, "parameter-panel");
            var heading = Add(panel, "section-heading");
            heading.Add(new Label("创建角色"));
            characterName = new TextField { value = session.CharacterName, maxLength = 40, name = "character-name" };
            characterName.tooltip = "角色名称";
            characterName.AddToClassList("character-name");
            characterName.RegisterValueChangedCallback(change => session.CharacterName = change.newValue);
            var tabBar = Add(panel, "tabs");
            tabs.Clear();
            for (int index = 0; index < CategoryNames.Length; index++)
            {
                int selected = index;
                tabs.Add(Command(tabBar, CategoryNames[index], CategoryNames[index], () => SelectCategory(selected), $"category-{index}"));
            }
            stepTitle = new Label();
            stepTitle.AddToClassList("step-title");
            subcategories = Add(panel, "subcategories");
            scroll = new ScrollView(ScrollViewMode.Vertical) { name = "parameter-scroll" };
            scroll.AddToClassList("parameter-scroll");
            panel.Add(scroll);
            sliders = scroll.contentContainer;
            viewport = Add(workspace, "viewport");
            viewport.name = "character-viewport";
            var tools = Add(viewport, "viewport-tools");
            previous = Command(tools, "←", "上一步", () => SelectCategory(category - 1), "previous-step");
            next = Command(tools, "→", "下一步", () => SelectCategory(category + 1), "next-step");
            randomize = Command(tools, "随机", "随机当前分组的外观参数", () => session.Randomize(fields.Keys), "randomize-character");
            reset = Command(tools, "重置", "恢复进入页面时的人物外观", session.ResetCharacter, "reset-character");
            next.AddToClassList("primary");
            restore = Command(tools, "恢复", "恢复本浏览器已保存的角色", session.LoadCharacter, "restore-character");
            save = Command(tools, "保存", "保存到本浏览器", session.SaveCharacter, "save-character");
            save.AddToClassList("primary");
            var poses = new ScrollView(ScrollViewMode.Vertical) { name = "pose-options" };
            poses.AddToClassList("pose-options");
            viewport.Add(poses);
            poseButtons.Clear();
            for (int index = 0; index < CharacterSession.PoseNames.Length; index++)
            {
                if (index == 1 || index == 4)
                {
                    var group = new Label(index == 1 ? "固定" : "动态");
                    group.AddToClassList("pose-group");
                    poses.Add(group);
                }
                int selected = index;
                var button = Command(poses.contentContainer, CharacterSession.PoseNames[index],
                    CharacterSession.PoseNames[index], () => session.SelectPose(selected), "pose-" + index);
                poseButtons.Add(button);
            }
            var identity = Add(viewport, "character-identity");
            identity.Add(characterName);
            status = new Label(session.Status) { name = "character-status" };
            status.AddToClassList("status-bar");
            identity.Add(status);
            viewport.RegisterCallback<PointerDownEvent>(change =>
            {
                if (change.target != viewport || change.button != 0 || !session.CanCommit) return;
                dragPointer = change.pointerId;
                dragPosition = change.position;
                viewport.CapturePointer(dragPointer);
                change.StopPropagation();
            });
            viewport.RegisterCallback<PointerMoveEvent>(change =>
            {
                if (change.pointerId != dragPointer || !viewport.HasPointerCapture(dragPointer)) return;
                Vector2 position = change.position;
                session.avatar.transform.Rotate(Vector3.up, -(position.x - dragPosition.x) * 0.45f, Space.World);
                dragPosition = position;
            });
            viewport.RegisterCallback<PointerUpEvent>(change => EndDrag(change.pointerId));
            viewport.RegisterCallback<PointerCancelEvent>(change => EndDrag(change.pointerId));
            viewport.RegisterCallback<PointerCaptureOutEvent>(change => dragPointer = -1);
            root.RegisterCallback<GeometryChangedEvent>(OnGeometryChanged);
            viewport.RegisterCallback<GeometryChangedEvent>(change => ResizeCamera());
            session.Changed += Refresh;
            Refresh();
        }

        private void EndDrag(int pointer)
        {
            if (pointer != dragPointer) return;
            viewport.ReleasePointer(pointer);
            dragPointer = -1;
        }

        private void OnDisable()
        {
            if (session != null) session.Changed -= Refresh;
            if (skinRamp != null) Destroy(skinRamp);
        }

        private void OnGeometryChanged(GeometryChangedEvent change)
        {
            root.EnableInClassList("compact", root.resolvedStyle.width < 700);
            ResizeCamera();
        }

        private void ResizeCamera()
        {
            if (studioCamera == null || root.resolvedStyle.width <= 0 || root.resolvedStyle.height <= 0) return;
            Rect bounds = viewport.worldBound;
            studioCamera.rect = new Rect(bounds.x / root.resolvedStyle.width,
                1 - bounds.yMax / root.resolvedStyle.height,
                Mathf.Max(1, bounds.width - 76) / root.resolvedStyle.width, bounds.height / root.resolvedStyle.height);
            FrameCharacter();
        }

        private void FrameCharacter()
        {
            if (!session.Ready || studioCamera == null || studioCamera.aspect <= 0) return;
            var renderer = session.avatar.GetComponentInChildren<SkinnedMeshRenderer>();
            if (renderer == null) return;
            Bounds bounds = renderer.bounds;
            if (session.PoseIndex == 0 && (category == 2 || category == 3) && session.avatar.umaData.skeleton != null)
            {
                var head = session.avatar.umaData.skeleton.GetBoneTransform("Head");
                if (head != null) bounds = new Bounds(head.position + Vector3.up * 0.08f, Vector3.one * 0.65f);
            }
            float tangent = Mathf.Tan(studioCamera.fieldOfView * Mathf.Deg2Rad * 0.5f);
            float distance = Mathf.Max(bounds.extents.y / tangent, bounds.extents.x / (tangent * studioCamera.aspect)) + bounds.extents.z;
            studioCamera.transform.position = bounds.center - studioCamera.transform.forward * distance * 1.08f;
        }

        private void Refresh()
        {
            status.text = session.Status;
            status.EnableInClassList("busy", session.Busy || session.HasPendingEdits);
            save.SetEnabled(session.CanCommit);
            restore.SetEnabled(session.CanCommit && session.HasSavedCharacter);
            reset.SetEnabled(session.CanCommit);
            randomize.SetEnabled(session.CanCommit && fields.Count > 0);
            characterName.SetEnabled(session.CanCommit);
            characterName.SetValueWithoutNotify(session.CharacterName);
            foreach (var tab in tabs) tab.SetEnabled(session.CanCommit);
            subcategories.SetEnabled(session.CanCommit);
            previous.SetEnabled(session.CanCommit && category > 0);
            next.SetEnabled(session.CanCommit && category < CategoryNames.Length - 1);
            for (int index = 0; index < poseButtons.Count; index++)
            {
                poseButtons[index].SetEnabled(session.CanCommit);
                poseButtons[index].EnableInClassList("selected", index == session.PoseIndex);
            }
            if (session.CanCommit && framedPose != session.PoseIndex)
            {
                framedPose = session.PoseIndex;
                FrameCharacter();
            }
            if (session.CanCommit && (!populated || displayedRace != session.RaceName))
                SelectCategory(category, true);
            foreach (var choice in choices) choice.SetEnabled(session.CanCommit);
            sliders.SetEnabled(session.Ready);
            if (session.CanCommit)
            {
                foreach (var selection in selections) selection.Key.EnableInClassList("selected", selection.Value());
                skinTone?.SetValueWithoutNotify(session.GetSkinTone());
                var values = session.GetValues();
                foreach (var field in fields)
                    if (values.TryGetValue(field.Key, out float value)) field.Value.SetValueWithoutNotify(value * 100);
            }
        }

        private void SelectCategory(int selected, bool keepSection = false)
        {
            if (selected < 0 || selected >= CategoryNames.Length) return;
            category = selected;
            PanelRevision++;
            populated = session.Ready;
            displayedRace = session.RaceName;
            stepTitle.text = CategoryNames[selected];
            if (!keepSection || !Sections[selected].Contains(subcategory)) subcategory = Sections[selected][0];
            for (int index = 0; index < tabs.Count; index++) tabs[index].EnableInClassList("selected", index == selected);
            subcategories.Clear();
            foreach (string section in Sections[selected])
            {
                var button = Command(subcategories, section, section, () => { subcategory = section; SelectCategory(category, true); }, "section-" + section);
                button.EnableInClassList("selected", section == subcategory);
            }
            previous.SetEnabled(session.CanCommit && category > 0);
            next.SetEnabled(session.CanCommit && category < CategoryNames.Length - 1);
            scroll.scrollOffset = Vector2.zero;
            sliders.Clear();
            skinTone = null;
            fields.Clear();
            choices.Clear();
            selections.Clear();
            if (!session.Ready) { sliders.Add(new Label("正在读取人物…")); return; }
            var values = session.GetValues();
            if (category == 2 && subcategory != "妆容") AddRegionPresets();
            if (category == 2 && subcategory == "眉毛") AddWardrobe("Eyebrows");
            foreach (string parameter in ParametersForSection().Distinct())
            {
                if (!values.TryGetValue(parameter, out float value)) continue;
                var slider = new Slider(TranslateParameter(parameter), 0, 100)
                {
                    value = value * 100, showInputField = false, name = "dna-" + parameter
                };
                slider.AddToClassList("dna-slider");
                slider.RegisterValueChangedCallback(change => session.QueueDna(parameter, change.newValue / 100));
                sliders.Add(slider);
                fields.Add(parameter, slider);
            }
            if (category == 0 && subcategory == "性别与预设") AddPresets();
            if (category == 0 && subcategory == "肤色") AddSkinTone();
            if (category == 2 && subcategory == "眼睛") AddColors("Eyes", "瞳色");
            if (category == 2 && subcategory == "妆容") AddWardrobe("Face");
            if (category == 3 && subcategory == "发型") AddWardrobe("Hair");
            if (category == 3 && subcategory == "发色") AddColors("Hair", "发色");
            if (category == 3 && subcategory == "胡须") AddWardrobe("Beard");
            if (category == 4) AddWardrobe(new[] { "Chest", "Legs", "Feet", "TopUnderlayer", "BottomUnderlayer" }[Array.IndexOf(Sections[4], subcategory)]);
            if (sliders.childCount == 0) sliders.Add(new Label("当前角色无可用选项"));
            randomize.style.display = DisplayStyle.Flex;
            randomize.SetEnabled(session.CanCommit && fields.Count > 0);
            FrameCharacter();
        }

        private IEnumerable<string> ParametersForSection()
        {
            if (category == 1)
                return session.bodyParameters.Concat(session.legParameters).Where(parameter =>
                {
                    string group = parameter.IndexOf("arm", StringComparison.OrdinalIgnoreCase) >= 0 || parameter.StartsWith("hands") ? "手臂" :
                        session.legParameters.Contains(parameter) ? "腿脚" : parameter == "height" || parameter.Contains("Muscle") || parameter.Contains("Weight") || parameter == "bodyFitness" ? "整体" : "躯干";
                    return group == subcategory;
                });
            if (category == 2)
                return session.faceParameters.Where(parameter =>
                {
                    string name = parameter.ToLowerInvariant();
                    string group = name.Contains("brow") ? "眉毛" : name.Contains("eye") ? "眼睛" : name.Contains("nose") ? "鼻子" :
                        name.Contains("lip") || name.Contains("mouth") ? "嘴唇" : name.Contains("chin") || name.Contains("jaw") || name.Contains("mandible") ? "下颌" :
                        name.Contains("ear") ? "耳朵" : "脸型";
                    return group == subcategory;
                });
            return Array.Empty<string>();
        }

        private void AddPresets()
        {
            var gender = Add(sliders, "gender-options");
            foreach (string race in session.AvailableRaces)
            {
                string label = race.Contains("Female") ? "女性" : "男性";
                var button = Command(gender, label, label, () => session.ChangeGender(race), "gender-" + (race.Contains("Female") ? "female" : "male"));
                button.EnableInClassList("selected", race == session.RaceName);
                selections[button] = () => race == session.RaceName;
                choices.Add(button);
            }
            AddCaption("外观预设");
            var grid = Add(sliders, "choice-grid");
            int index = 0;
            foreach (var preset in session.presets.Where(preset => preset.Definition.RaceName == session.RaceName))
            {
                string label = "预设 " + (++index).ToString("D2");
                var button = Tile(grid, label, "preset-" + preset.name, () => session.ApplyPreset(preset));
                if (preset.Icon != null) button.Insert(0, new Image { image = preset.Icon, scaleMode = ScaleMode.ScaleToFit });
            }
        }

        private void AddRegionPresets()
        {
            var parameters = ParametersForSection().Where(session.GetValues().ContainsKey).Distinct().ToArray();
            if (parameters.Length == 0) return;
            var grid = Add(sliders, "choice-grid");
            var signatures = new HashSet<string>();
            int index = 0;
            foreach (var preset in session.presets.Where(preset => preset.Definition.RaceName == session.RaceName))
            {
                var values = session.RegionValues(preset, parameters);
                string signature = string.Join(";", values.OrderBy(value => value.Key)
                    .Select(value => value.Key + "=" + Mathf.RoundToInt(value.Value * 10000)));
                if (!signatures.Add(signature)) continue;
                var button = Tile(grid, subcategory + " " + (++index).ToString("D2"), "region-" + preset.name,
                    () => session.ApplyRegionPreset(preset, parameters));
                button.tooltip = preset.name;
                if (preset.Icon != null) button.Insert(0, new Image { image = preset.Icon, scaleMode = ScaleMode.ScaleToFit });
                selections[button] = () =>
                {
                    var current = session.GetValues();
                    return values.All(value => current.TryGetValue(value.Key, out float actual) && Mathf.Abs(actual - value.Value) < 0.00015f);
                };
                button.EnableInClassList("selected", selections[button]());
            }
        }

        private void AddWardrobe(string slot)
        {
            var items = session.CompatibleWardrobe().Where(item => item.wardrobeSlot == slot).ToList();
            if (items.Count == 0) return;
            var grid = Add(sliders, "choice-grid");
            var remove = Tile(grid, "不使用", "remove-" + slot, () => session.RemoveSlot(slot));
            var empty = new Label("∅");
            empty.AddToClassList("empty-choice");
            remove.Insert(0, empty);
            selections[remove] = () => !session.avatar.WardrobeRecipes.ContainsKey(slot);
            remove.EnableInClassList("selected", selections[remove]());
            for (int index = 0; index < items.Count; index++)
            {
                var item = items[index];
                var button = Tile(grid, WardrobeLabel(item, index), "wear-" + item.name, () => session.Wear(item));
                selections[button] = () => session.avatar.WardrobeRecipes.TryGetValue(slot, out var current) && current == item;
                button.EnableInClassList("selected", selections[button]());
                var thumbnail = item.wardrobeRecipeThumbs.FirstOrDefault(thumb => thumb.thumb != null);
                if (thumbnail != null) button.Insert(0, new Image { sprite = thumbnail.thumb, scaleMode = ScaleMode.ScaleToFit });
            }
        }

        private void AddColors(string sharedName, string label)
        {
            AddCaption(label);
            var grid = Add(sliders, "swatch-grid");
            int index = 0;
            foreach (var table in session.colorTables.Where(table => table.sharedColorName == sharedName))
                foreach (var color in table.colors)
                {
                    string name = label + " " + (++index).ToString("D2");
                    var swatch = Command(grid, "", name, () => session.ChangeColor(sharedName, color), "color-" + sharedName + "-" + index);
                    swatch.AddToClassList("swatch");
                    swatch.style.backgroundColor = color.displayColor != Color.white ? color.displayColor : color.color;
                    selections[swatch] = () => session.avatar.characterColors.GetColor(sharedName, out OverlayColorData current) &&
                        current.channelMask.SequenceEqual(color.channelMask) &&
                        (current.PropertyBlock?.GetPropertyStrings() ?? Array.Empty<string>()).SequenceEqual(color.PropertyBlock?.GetPropertyStrings() ?? Array.Empty<string>());
                    swatch.EnableInClassList("selected", selections[swatch]());
                    choices.Add(swatch);
                }
        }

        private void AddSkinTone()
        {
            if (skinRamp == null)
            {
                skinRamp = new Texture2D(128, 1, TextureFormat.RGBA32, false);
                for (int index = 0; index < 128; index++) skinRamp.SetPixel(index, 0, CharacterSession.EvaluateSkinTone(index / 127f));
                skinRamp.Apply(false, true);
            }
            var ramp = new Image { image = skinRamp, scaleMode = ScaleMode.StretchToFill };
            ramp.AddToClassList("skin-ramp");
            sliders.Add(ramp);
            skinTone = new Slider("肤色", 0, 1) { name = "skin-tone", value = session.GetSkinTone(), showInputField = false };
            skinTone.AddToClassList("dna-slider");
            skinTone.RegisterValueChangedCallback(change => session.QueueSkinTone(change.newValue));
            sliders.Add(skinTone);
            var ends = Add(sliders, "tone-endpoints");
            ends.Add(new Label("浅"));
            ends.Add(new Label("深"));
        }

        private void AddCaption(string text)
        {
            var caption = new Label(text);
            caption.AddToClassList("caption");
            sliders.Add(caption);
        }

        private Button Tile(VisualElement parent, string text, string name, Action action)
        {
            var button = Command(parent, "", text, action, name);
            button.AddToClassList("choice-tile");
            button.Add(new Label(text));
            choices.Add(button);
            return button;
        }

        private string WardrobeLabel(UMAWardrobeRecipe item, int index)
        {
            string name = item.name.ToLowerInvariant();
            string kind = subcategory;
            var types = new Dictionary<string, string>
            {
                { "hoodie", "连帽卫衣" }, { "jacket", "夹克" }, { "tanktop", "背心" }, { "tshirt", "短袖" },
                { "dress", "连衣裙" }, { "sweater", "运动衫" }, { "sportswear", "运动上装" },
                { "skirt", "短裙" }, { "shorts", "短裤" }, { "tights", "紧身裤" }, { "pants", "长裤" },
                { "shoe", "运动鞋" }, { "bra", "内搭" }, { "underwear", "内搭" }, { "swimwear", "泳装" },
                { "freckled", "雀斑" }, { "makeup", "妆容" }, { "scar", "疤痕" }, { "senior", "年长" }, { "aged", "成熟" }
            };
            foreach (var type in types) if (name.Contains(type.Key)) { kind = type.Value; break; }
            return kind + " " + (index + 1).ToString("D2");
        }

        public static string TranslateParameter(string parameter)
        {
            string remaining = parameter.Replace("_", "").Replace(" ", "").ToLowerInvariant();
            return TryTranslate(remaining, out string translated) ? translated : "造型参数 " + parameter;
        }

        private static bool TryTranslate(string remaining, out string translated)
        {
            translated = "";
            if (remaining.Length == 0) return true;
            foreach (string word in Words.Keys.OrderByDescending(candidate => candidate.Length))
            {
                if (remaining.StartsWith(word, StringComparison.Ordinal) && TryTranslate(remaining.Substring(word.Length), out string suffix))
                {
                    translated = Words[word] + suffix;
                    return true;
                }
            }
            return false;
        }

        private static VisualElement Add(VisualElement parent, string className)
        {
            var element = new VisualElement();
            element.AddToClassList(className);
            parent.Add(element);
            return element;
        }

        private static Button Command(VisualElement parent, string text, string tooltip, Action command, string name)
        {
            var button = new Button(command) { text = text, tooltip = tooltip, name = name };
            parent.Add(button);
            return button;
        }
    }
}