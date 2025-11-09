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
type DubFormat = 'icon' | 'bracket'; // New type for the format setting

function init() {
    // This hook intercepts the schedule data just before it's sent to the user's screen.
    $app.onAnimeScheduleItems((e) => {
        try {
            // Get the user's current format preference
            const dubFormat = $store.get<DubFormat>("dub-format") || 'icon';
            const dubPrefix = dubFormat === 'icon' ? "🎙️Dub - " : "[DUB] ";

            // First, create a clean, definitive list of original (sub) items.
            const originalSubItems = (e.items || []).filter(item => !item.title.startsWith(dubPrefix));
            
            // Get the user's current filter preference and the list of dubbed items.
            const filter = $store.get<ScheduleFilter>("schedule-filter") || "all";
            const dubbedItems = $store.get<Anime_ScheduleItem[]>("dub-schedule-items") || [];

            // Filtering logic
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
        
        // New state for dub format
        const savedDubFormat = $storage.get<DubFormat>("dub-format") || 'icon';
        const dubFormatState = ctx.state<DubFormat>(savedDubFormat);
        $store.set("dub-format", savedDubFormat);

        // --- TRAY MENU ---
        const tray = ctx.newTray({
            tooltipText: "Schedule Filter",
            iconUrl: "https://raw.githubusercontent.com/Bas1874/Dub-Schedule-Seanime/refs/heads/main/src/icons/icon.png",
            withContent: true,
        });

        // Event handlers for the filter buttons
        ctx.registerEventHandler("set-filter-all", () => filterState.set("all"));
        ctx.registerEventHandler("set-filter-dub", () => filterState.set("dub"));
        ctx.registerEventHandler("set-filter-sub", () => filterState.set("sub"));
        ctx.registerEventHandler("set-filter-prefer-dub", () => filterState.set("prefer-dub"));

        // New event handlers for the format buttons
        ctx.registerEventHandler("set-format-icon", () => dubFormatState.set('icon'));
        ctx.registerEventHandler("set-format-bracket", () => dubFormatState.set('bracket'));

        // This effect runs whenever the user clicks a filter button.
        ctx.effect(() => {
            const newFilter = filterState.get();
            $storage.set("schedule-filter", newFilter);
            $store.set("schedule-filter", newFilter);

            let filterText = newFilter.toUpperCase();
            if (newFilter === 'prefer-dub') filterText = "Prefer Dubs";

            ctx.toast.info(`Filter set to: ${filterText}. Refreshing...`);
            $anilist.refreshAnimeCollection(); // Triggers UI refresh

        }, [filterState]);
        
        // New effect for the dub format toggle
        ctx.effect(async () => {
            const newFormat = dubFormatState.get();
            $storage.set("dub-format", newFormat);
            $store.set("dub-format", newFormat);

            const formatText = newFormat === 'icon' ? "Icon (🎙️)" : "Bracket ([DUB])";
            ctx.toast.info(`Dub format set to: ${formatText}. Refreshing...`);
            
            // Re-process the schedule data with the new format
            await fetchAndProcessDubSchedule();
            
            // Trigger UI refresh using the SAME mechanism
            $anilist.refreshAnimeCollection();

        }, [dubFormatState]);

        // Define the UI components inside the tray pop-up.
        tray.render(() => {
            const currentFilter = filterState.get();
            const currentFormat = dubFormatState.get();
            return tray.stack({
                gap: 2,
                items: [
                    tray.text("Display Options"),
                    tray.button("All (Subs & Dubs)", { intent: currentFilter === "all" ? "primary" : "gray-subtle", onClick: "set-filter-all" }),
                    tray.button("Prefer Dubs", { intent: currentFilter === "prefer-dub" ? "primary" : "gray-subtle", onClick: "set-filter-prefer-dub" }),
                    tray.button("Dubs Only", { intent: currentFilter === "dub" ? "primary" : "gray-subtle", onClick: "set-filter-dub" }),
                    tray.button("Subs Only", { intent: currentFilter === "sub" ? "primary" : "gray-subtle", onClick: "set-filter-sub" }),
                    
                    // FIX: Replaced tray.divider() with a styled div to create a visual separator
                    tray.div([], {
                        style: {
                            height: "1px",
                            backgroundColor: "rgba(255, 255, 255, 0.1)",
                            margin: "8px 0"
                        }
                    }),
                    
                    tray.text("Dub Title Format"),
                    tray.flex({
                        gap: 2,
                        items: [
                             tray.button("🎙️Dub", { intent: currentFormat === "icon" ? "primary" : "gray-subtle", onClick: "set-format-icon", width: "50%" }),
                             tray.button("[DUB]", { intent: currentFormat === "bracket" ? "primary" : "gray-subtle", onClick: "set-format-bracket", width: "50%" }),
                        ]
                    })
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
                
                // Get the current format preference to build the correct title
                const dubFormat = $store.get<DubFormat>("dub-format") || 'icon';
                const dubPrefix = dubFormat === 'icon' ? "🎙️Dub - " : "[DUB] ";

                for (const dubItem of dubSchedule) {
                    const anime = findAnimeInCollection(dubItem.media.media.id, animeCollection);
                    
                    if (anime) {
                        const airingDate = new Date(dubItem.episodeDate);
                        const totalEpisodes = anime.episodes ? parseInt($toString(anime.episodes)) : 0;
                        
                        const realItem: Anime_ScheduleItem = {
                            mediaId: anime.id,
                            title: `${dubPrefix}${anime.title?.userPreferred}`, // Use the selected prefix
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
                                        title: `${dubPrefix}${anime.title?.userPreferred}`, // Use the selected prefix
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

        // --- INITIALIZATION ---
        fetchAndProcessDubSchedule();
        ctx.setInterval(fetchAndProcessDubSchedule, 30 * 60 * 1000); // Re-fetch every 30 minutes
    });
}
