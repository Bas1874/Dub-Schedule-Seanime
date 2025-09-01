

# Dub Schedule for Seanime

Tired of checking multiple sites to see when your favorite anime dubs are coming out? This plugin is for you!

It integrates a dub schedule directly into Seanime's schedule page. Not only does it show you what's airing this week, but it also projects future episodes for ongoing shows, giving you a look ahead at the release calendar.


---

## ✨ Features

*   **Integrated Dub Schedule**: See upcoming dub releases right inside Seanime, just like you would for subs.
*   **Projections**: For shows that are currently airing, the plugin predicts future dub release dates based on the latest episode, so you always have an idea of what's next.
*   **Filter Your View**: A handy tray menu lets you instantly switch between viewing **Subs Only**, **Dubs Only**, or a combined **All** view.

## 🚀 Installation

1.  In Seanime, go to `Settings` -> `Extensions`.
2.  Click on the **Add Extension** button in the top right.
3.  Paste the following URL into the manifest URL field:

    ```
    [https://raw.githubusercontent.com/Bas1874/Dub-Schedule-Seanime/main/your-plugin-manifest.json](https://raw.githubusercontent.com/Bas1874/Dub-Schedule-Seanime/refs/heads/main/src/manifest.json)
    ```

4.  Click **Install**.
5.  Once it's installed, make sure to **give the plugin permissions** 

## 💡 How to Use

1.  After installation, you'll see a new icon in your tray (top right of the Seanime window).
2.  Click the icon to open the filter menu.
3.  Choose your preferred view:
    *   **All (Subs & Dubs)**: Shows both the original Seanime schedule and the new dub schedule.
    *   **Dubs Only**: Hides all subbed releases and only shows the dub schedule (including future projections).
    *   **Subs Only**: Hides the dub schedule and shows the default Seanime schedule.
4.  Navigate to the **Schedule** page to see the results! The page will automatically refresh to match your filter.

## How It Works

This plugin uses the [AniSchedule](https://github.com/RockinChaos/AniSchedule) project by RockinChaos as its data source for the current week's dub releases.

For ongoing shows found in the schedule, it checks the total episode count on AniList and projects a weekly release on the same day and time until the final episode is reached. This gives you a useful, unofficial look ahead for your favorite continuing dubs.
