export const createProgressManager = (bootState, campaignCount, maxInfiniteIndex, persistence) => {
    let campaignProgress = Number.isInteger(bootState.campaignProgress) ? bootState.campaignProgress : 0;
    let infiniteProgress = Number.isInteger(bootState.infiniteProgress) ? bootState.infiniteProgress : 0;

    return {
        readCampaignProgress: () => campaignProgress,
        readInfiniteProgress: () => infiniteProgress,
        isCampaignCompleted: () => campaignProgress >= campaignCount,
        isCampaignLevelUnlocked: (index) => index <= campaignProgress,
        markCampaignLevelCleared: (index) => {
            const nextProgress = Math.max(campaignProgress, index + 1);
            const clampedProgress = Math.min(nextProgress, campaignCount);
            if (clampedProgress === campaignProgress) return false;
            campaignProgress = clampedProgress;
            persistence.writeCampaignProgress(campaignProgress);
            return true;
        },
        markInfiniteLevelCleared: (infiniteIndex) => {
            const nextProgress = Math.min(maxInfiniteIndex, Math.max(infiniteProgress, infiniteIndex + 1));
            if (nextProgress === infiniteProgress) return false;
            infiniteProgress = nextProgress;
            persistence.writeInfiniteProgress(infiniteProgress);
            return true;
        }
    };
};
