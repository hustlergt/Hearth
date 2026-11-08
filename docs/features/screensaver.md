# Screen saver (rooted TVs, experimental)

A screen saver shows pictures when nobody has pressed a button for a while. Hearth's saver replaces the TV's own saver with **your pictures, GIFs, videos or a slideshow**. It is **on at first** and plays a short built-in **fireplace video**. If its set-up fails, Hearth turns it off and tells you.

![Screen saver tab](../screenshots/settings-saver.jpg)

Open **Settings, Screen saver**:

- **Custom Screen Saver:** the main switch.
- **Pictures:** what it plays: a photo, a GIF, a video (mp4, mkv or webm, plays quietly to its end), a folder, the bundled photos, **Aerial videos**, or the same as the wallpaper.
- **Change picture every** and **Shuffle**, for slideshows.
- **Picture size:** *Fit* shows the whole picture; *Fill* crops it to the screen.
- **OLED care:** a thin moving frame so one still picture cannot burn into the screen.
- **Brightness:** *Bright*, or *Dim* by an amount you choose, from 10% to 80% in steps of 10 (a dark layer; the backlight is not touched).
- **Switch the TV off after:** the TV goes to sleep after the saver has run this long (5 minutes at first).
- **Show it now:** starts it at once, so you can try it.

### Aerial videos

Choose **Aerial videos (streamed)** under *Pictures* to play the aerial flights from Apple TV, Amazon Fire TV, Jetson Creative and Robin Fourcade (about 340 clips). They are streamed, so the TV needs the network. These rows appear with it:

- **Aerial quality:** *Full HD*, *4K SDR* (the default) or *4K HDR / Dolby Vision*. 4K SDR keeps the TV out of HDR, so its HDR or Dolby Vision badge does not pop up. A clip that has no HDR version plays in 4K SDR.
- **Apple Aerials**, **Amazon Fire TV**, **Jetson Creative**, **Robin Fourcade:** which feeds to play. One always stays on.
- **Place names:** where each clip was filmed, and what is in view, in the corner. With *OLED care* on, the text drifts a few pixels every minute.

Good to know:

- If a paused app (YouTube, Netflix...) still holds the TV's video decoder, the saver shows the bundled photos instead, so that app can resume afterwards.
- If five clips in a row will not play (no network, for example), the saver switches to the bundled photos.
- When the saver ends, the video player is stopped and let go at once.
- The list of videos and the place names come from [custom-screensaver-aerial](https://github.com/aabytt/custom-screensaver-aerial) by aabytt (MIT). Thank you!

**The TV decides when the saver starts.** It uses the idle time from the TV's own screen saver settings, so that setting must be on. Any key stops the saver.

Good to know:

- Nothing is written on the TV's storage. A restart puts LG's saver back, and Hearth puts its own on again.
- GIFs, videos and fast slideshows use more power than one still picture. A very big GIF or video may use a lot of memory.
- Put your own saver pictures in `/media/developer/screensavers` (see [Wallpaper](wallpaper.md#your-own-pictures-rooted-tv)).
- **On webOS 10 and newer this is untested.** The TV's own saver is built differently there and some TVs refuse the change. Some TVs also hold the saver back (OLED, or inputs with no signal).
- If it does not work, switch on the Debug tab (see [System](system.md#debug-tab)) and send us the report.
