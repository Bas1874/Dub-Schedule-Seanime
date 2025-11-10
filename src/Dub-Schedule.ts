function init() {
    // This hook intercepts the schedule data just before it's sent to the user's screen.
    $app.onAnimeScheduleItems((e) => {
        try {
            // Get the user's current format preference and determine the correct prefix
            const dubFormat = $store.get("dub-format") || 'icon';
            let dubPrefix = "🎙️Dub - "; // Default
            if (dubFormat === 'bracket') {
                dubPrefix = "[DUB] ";
            } else if (dubFormat === 'icon-only') {
                dubPrefix = "🎙️ - ";
            }

            // First, create a clean, definitive list of original (sub) items.
            const originalSubItems = (e.items || []).filter(item => !item.title.startsWith(dubPrefix));
            
            // Get the user's current filter preference and the list of dubbed items.
            const filter = $store.get("schedule-filter") || "all";
            const dubbedItems = $store.get("dub-schedule-items") || [];

            // Filtering logic
            if (filter === "dub") {
                e.items = dubbedItems;
            } 
            else if (filter === "sub") {
                e.items = originalSubItems;
            } 
            else if (filter === "prefer-dub") {
                const combinedMap = new Map();
                originalSubItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}`, item));
                dubbedItems.forEach(item => combinedMap.set(`${item.mediaId}-${item.episodeNumber}`, item));
                e.items = Array.from(combinedMap.values());
            } 
            else { // "all"
                const combinedMap = new Map();
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
        const savedFilter = $storage.get("schedule-filter") || "all";
        const filterState = ctx.state(savedFilter);
        $store.set("schedule-filter", savedFilter);
        
        const savedDubFormat = $storage.get("dub-format") || 'icon';
        const dubFormatState = ctx.state(savedDubFormat);
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

        // Event handlers for the format buttons
        ctx.registerEventHandler("set-format-icon", () => dubFormatState.set('icon'));
        ctx.registerEventHandler("set-format-bracket", () => dubFormatState.set('bracket'));
        ctx.registerEventHandler("set-format-icon-only", () => dubFormatState.set('icon-only'));

        // Effect for filter changes
        ctx.effect(() => {
            const newFilter = filterState.get();
            $storage.set("schedule-filter", newFilter);
            $store.set("schedule-filter", newFilter);
            let filterText = newFilter === 'prefer-dub' ? "Prefer Dubs" : newFilter.toUpperCase();
            ctx.toast.info(`Filter set to: ${filterText}. Refreshing...`);
            $anilist.refreshAnimeCollection();
        }, [filterState]);
        
        // Effect for dub format changes
        ctx.effect(async () => {
            const newFormat = dubFormatState.get();
            $storage.set("dub-format", newFormat);
            $store.set("dub-format", newFormat);
            
            let formatText = '';
            if (newFormat === 'icon') formatText = "Icon & Text (🎙️Dub)";
            else if (newFormat === 'bracket') formatText = "Bracket ([DUB])";
            else formatText = "Icon Only (🎙️)";

            ctx.toast.info(`Dub format set to: ${formatText}. Refreshing...`);
            await fetchAndProcessDubSchedule();
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
                    
                    tray.div([], { style: { height: "1px", backgroundColor: "rgba(255, 255, 255, 0.1)", margin: "8px 0" } }),
                    
                    tray.text("Dub Title Format"),
                    tray.flex({
                        gap: 2,
                        items: [
                             tray.button("🎙️Dub", { intent: currentFormat === "icon" ? "primary" : "gray-subtle", onClick: "set-format-icon" }),
                             tray.button("🎙️", { intent: currentFormat === "icon-only" ? "primary" : "gray-subtle", onClick: "set-format-icon-only" }),
                             tray.button("[DUB]", { intent: currentFormat === "bracket" ? "primary" : "gray-subtle", onClick: "set-format-bracket" }),
                        ]
                    })
                ],
            });
        });
        
        // --- NEW TYPE FOR THE FEED DATA ---
        interface DubFeedItem {
            id: number;
            episode: {
                aired: number;
                airedAt: string;
            };
        }

        // --- BACKGROUND DATA FETCHING & PROCESSING ---
        const fetchAndProcessDubSchedule = async () => {
            try {
                // Fetch both current schedule and past feed from the new URLs
                const currentScheduleResponse = await ctx.fetch("https://raw.githubusercontent.com/Bas1874/AniSchedule/refs/heads/master/raw/dub-schedule.json");
                const pastFeedResponse = await ctx.fetch("https://raw.githubusercontent.com/Bas1874/AniSchedule/refs/heads/master/raw/dub-episode-feed.json");

                if (!currentScheduleResponse.ok || !pastFeedResponse.ok) {
                    console.error("Failed to fetch one or both dub schedules.");
                    return;
                }

                const currentDubSchedule = currentScheduleResponse.json();
                const pastDubFeed = pastFeedResponse.json();

                // Transform the past feed data to match the DubScheduleItem structure
                const transformedPastSchedule = pastDubFeed.map(item => ({
                    episodeDate: item.episode.airedAt,
                    episodeNumber: item.episode.aired,
                    media: {
                        media: {
                            id: item.id
                        }
                    }
                }));

                // Combine the current and past schedules
                const dubSchedule = [...currentDubSchedule, ...transformedPastSchedule];
                
                const animeCollection = await $anilist.getAnimeCollection(true);
                if (!animeCollection) return;

                const allDubbedItems = [];
                
                const dubFormat = $store.get("dub-format") || 'icon';
                let dubPrefix = "🎙️Dub - "; // Default
                if (dubFormat === 'bracket') {
                    dubPrefix = "[DUB] ";
                } else if (dubFormat === 'icon-only') {
                    dubPrefix = "🎙️ - ";
                }

                // Create a Set to track unique combinations of mediaId and episodeNumber
                const uniqueEntries = new Set();

                for (const dubItem of dubSchedule) {
                    const uniqueKey = `${dubItem.media.media.id}-${dubItem.episodeNumber}`;
                    if (uniqueEntries.has(uniqueKey)) {
                        continue; // Skip if this episode for this anime has already been processed
                    }
                    uniqueEntries.add(uniqueKey);

                    const anime = findAnimeInCollection(dubItem.media.media.id, animeCollection);
                    
                    if (anime) {
                        const airingDate = new Date(dubItem.episodeDate);
                        const totalEpisodes = anime.episodes ? parseInt($toString(anime.episodes)) : 0;
                        
                        const scheduleItem = {
                            mediaId: anime.id,
                            title: `${dubPrefix}${anime.title?.userPreferred}`,
                            time: airingDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
                            dateTime: airingDate.toISOString(),
                            image: anime.coverImage?.large || anime.coverImage?.medium,
                            episodeNumber: dubItem.episodeNumber,
                            isMovie: anime.format === "MOVIE",
                            isSeasonFinale: totalEpisodes > 0 && dubItem.episodeNumber === totalEpisodes,
                        };
                        allDubbedItems.push(scheduleItem);
                    }
                }

                $store.set("dub-schedule-items", allDubbedItems);
                
                $app.invalidateClientQuery(["GetAnimeSchedule"]);

            } catch (error) {
                console.error("Dub-Schedule UI Error:", error);
            }
        };

        function findAnimeInCollection(mediaId, animeCollection) {
            if (!animeCollection?.MediaListCollection?.lists) return null;
            for (const list of animeCollection.MediaListCollection.lists) {
                for (const entry of list.entries) {
                    if (entry.media.id === mediaId) return entry.media || null;
                }
            }
            return null;
        }

        // --- INITIALIZATION ---
        fetchAndProcessDubSchedule();
        ctx.setInterval(fetchAndProcessDubSchedule, 30 * 60 * 1000);
    });
}
