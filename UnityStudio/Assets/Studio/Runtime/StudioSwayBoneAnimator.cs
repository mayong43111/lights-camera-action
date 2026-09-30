using System.Collections.Generic;
using System.Linq;
using UMA;

namespace Studio
{
    public sealed class StudioSwayBoneAnimator : SwayBoneAnimator
    {
        public int ValidChains { get; private set; }
        public int SkippedChains { get; private set; }

        public override void Initialize(UMAData data, SlotData slot)
        {
            initialized = false;
            ValidChains = 0;
            SkippedChains = 0;
            if (data == null || data.skeleton == null || (slot != null && (slot.isDisabled || slot.tempHidden))) return;
            var originalChains = Chains;
            string originalAnchor = AnchorBoneName;
            var configured = originalChains != null && originalChains.Count > 0 ? originalChains :
                new List<ChainDefinition> { new ChainDefinition { AnchorBoneName = originalAnchor } };
            Chains = configured.Where(chain => chain != null && !string.IsNullOrEmpty(chain.AnchorBoneName) &&
                data.skeleton.GetBoneTransform(chain.AnchorBoneName) != null).Select(chain => new ChainDefinition
                {
                    AnchorBoneName = chain.AnchorBoneName,
                    ExcludedBoneNames = (chain.ExcludedBoneNames ?? new List<string>())
                        .Where(name => !string.IsNullOrEmpty(name) && data.skeleton.GetBoneTransform(name) != null).ToList()
                }).ToList();
            ValidChains = Chains.Count;
            SkippedChains = configured.Count - ValidChains;
            AnchorBoneName = "";
            try
            {
                if (ValidChains > 0) base.Initialize(data, slot);
            }
            finally
            {
                Chains = originalChains;
                AnchorBoneName = originalAnchor;
            }
        }
    }
}