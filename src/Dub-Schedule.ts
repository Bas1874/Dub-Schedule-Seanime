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

            // Remove any previously-injected dub entries regardless of which format
            // they were created with (prevents duplicates after switching formats).
            const DUB_PREFIXES = ["🎙️Dub - ", "🎙️ - ", "[DUB] "];
            const originalSubItems = (e.items || []).filter(item => !DUB_PREFIXES.some(p => (item.title || "").startsWith(p)));

            // Get the user's current filter preference and the list of dubbed items.
            // Dub items are stored WITHOUT a prefix; the current prefix is applied
            // here at serve time, so changing the format never requires a re-fetch.
            const filter = $store.get("schedule-filter") || "all";
            const rawDubItems = $store.get("dub-schedule-items") || [];
            const dubbedItems = rawDubItems.map(item => ({ ...item, title: `${dubPrefix}${item.title}` }));

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

        // Load the last successful dub schedule from persistent storage so the
        // page is populated immediately after a restart, even before the first
        // fetch completes (stale-while-revalidate).
        const cachedDubItems = $storage.get("dub-schedule-items") || [];
        if (cachedDubItems.length > 0) {
            $store.set("dub-schedule-items", cachedDubItems);
            $app.invalidateClientQuery(["GetAnimeSchedule"]);
        }

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

        // Manual refresh: fully re-fetches the dub data from GitHub and the
        // AniList collection, then forces the schedule page to re-render.
        ctx.registerEventHandler("force-refresh", async () => {
            ctx.toast.info("Dub Schedule: refreshing data...");
            fetchRetryCount = 0; // Allow a fresh round of retries
            await fetchAndProcessDubSchedule();
            $anilist.refreshAnimeCollection();
        });

        // Effect for filter changes
        ctx.effect(() => {
            const newFilter = filterState.get();
            $storage.set("schedule-filter", newFilter);
            $store.set("schedule-filter", newFilter);
            let filterText = newFilter === 'prefer-dub' ? "Prefer Dubs" : newFilter.toUpperCase();
            ctx.toast.info(`Filter set to: ${filterText}. Refreshing...`);
            // This method works reliably to trigger a schedule refresh.
            $anilist.refreshAnimeCollection();
        }, [filterState]);

        // Effect for dub format changes
        ctx.effect(() => {
            const newFormat = dubFormatState.get();
            $storage.set("dub-format", newFormat);
            $store.set("dub-format", newFormat);

            let formatText = '';
            if (newFormat === 'icon') formatText = "Icon & Text (🎙️Dub)";
            else if (newFormat === 'bracket') formatText = "Bracket ([DUB])";
            else formatText = "Icon Only (🎙️)";

            ctx.toast.info(`Dub format set to: ${formatText}. Refreshing...`);
            // The prefix is applied in the hook at serve time, so no network
            // re-fetch of the dub data is needed — but a collection refresh is
            // required to force the schedule page to actually re-render.
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
                    }),

                    tray.div([], { style: { height: "1px", backgroundColor: "rgba(255, 255, 255, 0.1)", margin: "8px 0" } }),

                    tray.button("🔄 Refresh Data", { intent: "gray-subtle", onClick: "force-refresh" }),
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

        // Retry with backoff: on startup, the network or AniList may not be ready yet.
        // Without this, a single failed fetch left the schedule empty for 30 minutes
        // (until the interval fired again), which looked like the plugin was broken.
        let fetchRetryCount = 0;
        const MAX_FETCH_RETRIES = 5;
        const scheduleRetry = () => {
            if (fetchRetryCount >= MAX_FETCH_RETRIES) {
                console.error("Dub-Schedule: giving up after " + MAX_FETCH_RETRIES + " failed attempts. Will try again on the 30-minute interval.");
                ctx.toast.error("Dub Schedule: couldn't load dub data. Retrying automatically in 30 minutes.");
                return;
            }
            fetchRetryCount++;
            const delay = 5000 * fetchRetryCount; // 5s, 10s, 15s, 20s, 25s
            console.log(`Dub-Schedule: fetch failed, retrying in ${delay / 1000}s (attempt ${fetchRetryCount}/${MAX_FETCH_RETRIES})`);
            ctx.setTimeout(() => fetchAndProcessDubSchedule(), delay);
        };

        const fetchAndProcessDubSchedule = async () => {
            try {
                // Fetch both current schedule and past feed from the new URLs
                const currentScheduleResponse = await ctx.fetch("https://raw.githubusercontent.com/Bas1874/AniSchedule/refs/heads/master/raw/dub-schedule.json");
                const pastFeedResponse = await ctx.fetch("https://raw.githubusercontent.com/Bas1874/AniSchedule/refs/heads/master/raw/dub-episode-feed.json");

                if (!currentScheduleResponse.ok || !pastFeedResponse.ok) {
                    console.error("Failed to fetch one or both dub schedules.");
                    scheduleRetry();
                    return;
                }

                const currentDubScheduleRaw = currentScheduleResponse.json();
                const pastDubFeedRaw = pastFeedResponse.json();

                // Guard against unexpected/partial JSON responses
                const currentDubSchedule = Array.isArray(currentDubScheduleRaw) ? currentDubScheduleRaw : [];
                const pastDubFeed = Array.isArray(pastDubFeedRaw) ? pastDubFeedRaw : [];

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

                // Try a fresh collection first; fall back to the cached one if AniList
                // isn't reachable yet (common right after startup).
                let animeCollection = null;
                try {
                    animeCollection = await $anilist.getAnimeCollection(true);
                } catch (e) {
                    console.error("Dub-Schedule: fresh collection fetch failed, trying cache.", e);
                }
                if (!animeCollection) {
                    try {
                        animeCollection = await $anilist.getAnimeCollection(false);
                    } catch (e) { }
                }
                if (!animeCollection) {
                    scheduleRetry();
                    return;
                }

                const allDubbedItems = [];

                // Build a fast lookup map of the user's collection once,
                // instead of scanning every list for every schedule entry.
                const collectionMap = new Map();
                for (const list of (animeCollection.MediaListCollection?.lists || [])) {
                    for (const entry of (list.entries || [])) {
                        if (entry?.media?.id && !collectionMap.has(entry.media.id)) {
                            collectionMap.set(entry.media.id, entry.media);
                        }
                    }
                }

                // Create a Set to track unique combinations of mediaId and episodeNumber
                const uniqueEntries = new Set();

                for (const dubItem of dubSchedule) {
                    const uniqueKey = `${dubItem.media.media.id}-${dubItem.episodeNumber}`;
                    if (uniqueEntries.has(uniqueKey)) {
                        continue; // Skip if this episode for this anime has already been processed
                    }
                    uniqueEntries.add(uniqueKey);

                    const anime = collectionMap.get(dubItem.media.media.id);

                    if (anime) {
                        const airingDate = new Date(dubItem.episodeDate);
                        const totalEpisodes = anime.episodes ? parseInt($toString(anime.episodes)) : 0;

                        const scheduleItem = {
                            mediaId: anime.id,
                            // Stored WITHOUT a prefix — the hook applies the current
                            // format's prefix at serve time.
                            title: anime.title?.userPreferred || anime.title?.romaji || "Unknown",
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
                $storage.set("dub-schedule-items", allDubbedItems); // Persist for instant startup next time
                fetchRetryCount = 0; // Success: reset the retry counter

                $app.invalidateClientQuery(["GetAnimeSchedule"]);

            } catch (error) {
                console.error("Dub-Schedule UI Error:", error);
                scheduleRetry();
            }
        };

        // --- INITIALIZATION ---
        fetchAndProcessDubSchedule();
        ctx.setInterval(fetchAndProcessDubSchedule, 30 * 60 * 1000);
    });
}
