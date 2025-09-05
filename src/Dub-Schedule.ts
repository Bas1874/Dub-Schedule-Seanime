/// <reference path="../plugin.d.ts" />
/// <reference path="../app.d.ts" />
/// <reference path="../core.d.ts" />

// Type for the items from the external JSON file
interface DubScheduleItem {
    episodeDate: string;
    episodeNumber: number;
    media: {
        media: {
            id: number;
        }
    };
}

// The exact format Seanime's schedule page expects
interface Anime_ScheduleItem {
    mediaId: number;
    title: string;
    time: string;
    dateTime?: string;
    image: string;
    episodeNumber: number;
    isMovie: boolean;
    isSeasonFinale: boolean;
}

type ScheduleFilter = "all" | "dub" | "sub" | "prefer-dub";

function init() {
    // This hook intercepts the schedule data just before it's sent to the user's screen.
    $app.onAnimeScheduleItems((e) => {
        try {
            // First, create a clean, definitive list of original (sub) items.
            const originalSubItems = (e.items || []).filter(item => !item.title.startsWith("[DUB]"));
            
            // Get the user's current filter preference and the list of dubbed items.
            const filter = $store.get<ScheduleFilter>("schedule-filter") || "all";
            const dubbedItems = $store.get<Anime_ScheduleItem[]>("dub-schedule-items") || [];

            // Filtering logic has been updated to remove "prefer-sub"
            if (filter === "dub") {
                e.items = dubbedItems;
            } 
            else if (filter === "sub") {
                e.items = originalSubItems;
            } 
            else if (filter === "prefer-dub") {
                const combinedMap = new Map<string, Anime_ScheduleItem>();
                // Add subs first
                originalSubItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}`, item));
                // Add dubs second, overwriting any subs for the same episode
                dubbedItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}`, item));
                e.items = Array.from(combinedMap.values());
            } 
            else { // "all"
                // For the "all" filter, use a unique key to ensure no overwriting occurs.
                const combinedMap = new Map<string, Anime_ScheduleItem>();
                originalSubItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}-sub`, item));
                dubbedItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}-dub`, item));
                e.items = Array.from(combinedMap.values());
            }

            // Always sort the final list chronologically
            if (e.items) {
                e.items.sort((a, b) => {
                    const dateA = a.dateTime ? new Date(a.dateTime).getTime() : 0;
                    const dateB = b.dateTime ? new Date(b.dateTime).getTime() : 0;
                    return dateA - dateB;
                });
            }

        } catch (error) {
            console.error("Dub-Schedule Hook Error:", error);
        } finally {
            e.next(); // Pass the modified data to the UI
        }
    });

    $ui.register(async (ctx) => {
        // --- STATE & STORAGE ---
        const savedFilter = $storage.get<ScheduleFilter>("schedule-filter") || "all";
        const filterState = ctx.state<ScheduleFilter>(savedFilter);
        $store.set("schedule-filter", savedFilter);

        // --- TRAY MENU ---
        const tray = ctx.newTray({
            tooltipText: "Schedule Filter",
            iconUrl: "https://raw.githubusercontent.com/Bas1874/Dub-Schedule-Seanime/refs/heads/main/src/icons/icon.png",
            withContent: true,
        });

        // Event handlers for the tray buttons, "set-filter-prefer-sub" removed
        ctx.registerEventHandler("set-filter-all", () => filterState.set("all"));
        ctx.registerEventHandler("set-filter-dub", () => filterState.set("dub"));
        ctx.registerEventHandler("set-filter-sub", () => filterState.set("sub"));
        ctx.registerEventHandler("set-filter-prefer-dub", () => filterState.set("prefer-dub"));

        // This effect runs whenever the user clicks a filter button.
        ctx.effect(() => {
            const newFilter = filterState.get();
            $storage.set("schedule-filter", newFilter);
            $store.set("schedule-filter", newFilter);

            // Create a user-friendly text for the toast message
            let filterText = newFilter.toUpperCase();
            if (newFilter === 'prefer-dub') filterText = "Prefer Dubs";

            ctx.toast.info(`Filter set to: ${filterText}. Refreshing...`);
            
            // This method works reliably to trigger a schedule refresh.
            $anilist.refreshAnimeCollection();

        }, [filterState]);

        // Define the UI components inside the tray pop-up, "Prefer Subs" button removed.
        tray.render(() => {
            const currentFilter = filterState.get();
            return tray.stack({
                gap: 2,
                items: [
                    tray.text("Display Options"),
                    tray.button("All (Subs & Dubs)", { intent: currentFilter === "all" ? "primary" : "gray-subtle", onClick: "set-filter-all" }),
                    tray.button("Prefer Dubs", { intent: currentFilter === "prefer-dub" ? "primary" : "gray-subtle", onClick: "set-filter-prefer-dub" }),
                    tray.button("Dubs Only", { intent: currentFilter === "dub" ? "primary" : "gray-subtle", onClick: "set-filter-dub" }),
                    tray.button("Subs Only", { intent: currentFilter === "sub" ? "primary" : "gray-subtle", onClick: "set-filter-sub" }),
                ],
            });
        });

        // --- BACKGROUND DATA FETCHING & PROJECTION ---
        const fetchAndProcessDubSchedule = async () => {
            try {
                const response = await ctx.fetch("https://raw.githubusercontent.com/RockinChaos/AniSchedule/refs/heads/master/readable/dub-schedule-readable.json");
                if (!response.ok) return;
                const dubSchedule: DubScheduleItem[] = response.json();
                
                const animeCollection = await $anilist.getAnimeCollection(true);
                if (!animeCollection) return;

                const realDubItems: Anime_ScheduleItem[] = [];
                const projectedDubItems: Anime_ScheduleItem[] = [];

                for (const dubItem of dubSchedule) {
                    const anime = findAnimeInCollection(dubItem.media.media.id, animeCollection);
                    
                    if (anime) {
                        const airingDate = new Date(dubItem.episodeDate);
                        const totalEpisodes = anime.episodes ? parseInt($toString(anime.episodes)) : 0;
                        
                        const realItem: Anime_ScheduleItem = {
                            mediaId: anime.id,
                            title: `[DUB] ${anime.title?.userPreferred}`,
                            time: airingDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
                            dateTime: airingDate.toISOString(),
                            image: anime.coverImage?.large || anime.coverImage?.medium!,
                            episodeNumber: dubItem.episodeNumber,
                            isMovie: anime.format === "MOVIE",
                            isSeasonFinale: totalEpisodes > 0 && dubItem.episodeNumber === totalEpisodes,
                        };
                        realDubItems.push(realItem);

                        if (totalEpisodes > 0) {
                            const episodesLeft = totalEpisodes - dubItem.episodeNumber;
                            if (episodesLeft > 0) {
                                for (let i = 1; i <= episodesLeft; i++) {
                                    const futureEpisodeNumber = dubItem.episodeNumber + i;
                                    const futureDate = new Date(airingDate);
                                    futureDate.setDate(futureDate.getDate() + (7 * i));

                                    projectedDubItems.push({
                                        mediaId: anime.id,
                                        title: `[DUB] ${anime.title?.userPreferred}`,
                                        time: futureDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
                                        dateTime: futureDate.toISOString(),
                                        image: anime.coverImage?.large || anime.coverImage?.medium!,
                                        episodeNumber: futureEpisodeNumber,
                                        isMovie: false,
                                        isSeasonFinale: futureEpisodeNumber === totalEpisodes,
                                    });
                                }
                            }
                        }
                    }
                }

                const allDubbedItems = [...realDubItems, ...projectedDubItems];
                $store.set("dub-schedule-items", allDubbedItems);
                
                $app.invalidateClientQuery(["GetAnimeSchedule"]);

            } catch (error) {
                console.error("Dub-Schedule UI Error:", error);
            }
        };

        function findAnimeInCollection(mediaId: number, animeCollection?: $app.AL_AnimeCollection): $app.AL_BaseAnime | null {
            if (!animeCollection?.MediaListCollection?.lists) return null;
            for (const list of animeCollection.MediaListCollection.lists) {
                for (const entry of list.entries!) {
                    if (entry.media!.id === mediaId) return entry.media || null;
                }
            }
            return null;
        }

        // --- DOM MANIPULATION FOR DUB BADGES ---
        const addDubBadges = async (entries: $ui.DOMElement[]) => {
            for (const entry of entries) {
                try {
                    if (await entry.queryOne(".dub-badge")) continue;
                    const titleEl = await entry.queryOne("p");
                    if (!titleEl) continue;
                    const titleText = await titleEl.getText();
                    if (titleText.startsWith("[DUB]")) {
                        const badge = await ctx.dom.createElement("span");
                        badge.setText("DUB");
                        badge.setAttribute("class", "dub-badge");
                        badge.setStyle("background-color", "rgb(var(--brand-color))");
                        badge.setStyle("color", "white");
                        badge.setStyle("padding", "2px 6px");
                        badge.setStyle("font-size", "10px");
                        badge.setStyle("border-radius", "4px");
                        badge.setStyle("margin-right", "8px");
                        badge.setStyle("font-weight", "bold");
                        await titleEl.before(badge);
                        await titleEl.setText(titleText.replace("[DUB]", "").trim());
                    }
                } catch (e) { /* fail silently */ }
            }
        };

        ctx.screen.onNavigate(e => {
            if (e.pathname === "/schedule") {
                ctx.dom.observe("[data-testid='schedule-entry']", addDubBadges);
            }
        });

        // --- INITIALIZATION ---
        fetchAndProcessDubSchedule();
        ctx.setInterval(fetchAndProcessDubSchedule, 30 * 60 * 1000); // Re-fetch every 30 minutes
    });
}
