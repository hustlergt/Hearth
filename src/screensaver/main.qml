/*
 * Hearth screen saver (experimental): a slideshow of the user's wallpaper photos, animated GIFs and videos.
 *
 * The TV's own screen saver app (com.webos.app.screensaver) loads this file instead of its own: screensaver.sh
 * bind-mounts it over the app's QML (memory only, nothing on the flash changes). The settings below and the list of
 * photos are filled in by screensaver.sh before it is mounted. The platform dismisses a screen saver on any key, so
 * nothing here handles keys.
 *
 * Black ground, slow cross-fade (the new picture fades in over the old one), pictures decoded no larger than 1920x1080. Optional Dim layer and OLED care frame for a single item.
 *
 * Aerial (source @aerial): streamed clips from the Aerial feeds (Apple, Amazon Fire OS, Jetson Creative, Robin Fourcade)
 * with their place names, as in custom-screensaver-aerial (aabytt, MIT); the feed handling, the place-name timing and the
 * decoder check follow that project, the code here is our own. One player at a time (a fade through black between clips:
 * two 4K streams at once is more than the TV's video planes are known to take). When another app holds a video decoder,
 * or clips keep failing (no network), the bundled photos play instead.
 */
import QtQuick 2.5
import Eos.Window 0.1

WebOSWindow {
    id: win

    // Sized for the compositor's 1920x1080 layout rather than from Screen, which can report smaller.
    width: 1920
    height: 1080

    windowType: "_WEBOS_WINDOW_TYPE_SCREENSAVER"
    appId: "com.webos.app.screensaver"
    title: "Screen Saver"
    visible: true
    color: "black"

    // B2: an explicit opaque black base under everything. The window colour alone left the OLED care frame (and any bar) see-through
    // on the TV, so the app that was open (YouTube) showed there; this layer draws solid black pixels (alpha 255).
    Rectangle {
        z: -100
        x: 0
        y: 0
        width: 1920
        height: 1080
        color: "#ff000000"
    }

    property var photos: [
//@PHOTOS@
        ""
    ]
    property int intervalSec: __INTERVAL__
    property bool shuffle: __SHUFFLE__
    property bool dim: __DIM__
    // OLED care for a single item (picture, GIF or video): 0 off, 1 on
    property int careMode: __CARE__
    // picture size: 0 fit the whole picture (bars), 1 fill the screen (cropped); pictures, GIFs and videos
    property bool fill: __FILL__ === 1

    // OLED care (single item only): the picture is fitted inside a thin black frame and moves a few pixels about every
    // minute, so no pixel stays lit in one place. A slideshow has no frame and no drift.
    property int frame: 0
    property int driftStep: 0
    property bool driftAnimated: false
    function tri(t, n) {
        var m = t % (4 * n);
        if (m < n) return m;
        if (m < 3 * n) return 2 * n - m;
        return m - 4 * n;
    }
    // a 10 px frame; steps of 2 px: +-8 px across, +-6 px down, so the picture never leaves the screen
    property int offX: frame > 0 ? frame + 2 * tri(driftStep, 4) : 0
    property int offY: frame > 0 ? frame + 2 * tri(driftStep, 3) : 0

    property var list: []
    property var order: []
    property int at: -1
    property bool frontIsA: false

    function prepare() {
        var l = [];
        for (var i = 0; i < photos.length; i++) if (photos[i] !== "") l.push(photos[i]);
        list = l;
        var o = [];
        for (var j = 0; j < l.length; j++) o.push(j);
        if (shuffle) {
            for (var k = o.length - 1; k > 0; k--) {
                var r = Math.floor(Math.random() * (k + 1));
                var t = o[k]; o[k] = o[r]; o[r] = t;
            }
            // and the session starts at a random point of the shuffled list
            var s0 = Math.floor(Math.random() * o.length);
            o = o.slice(s0).concat(o.slice(0, s0));
        } else if (o.length > 1) {
            // sequential, but not always starting at the same picture
            var s = Math.floor(Math.random() * o.length);
            o = o.slice(s).concat(o.slice(0, s));
        }
        order = o;
        // one item only (picture, GIF or video): the thin frame and the slow drift
        if (l.length === 1 && careMode > 0) {
            frame = 10;
            console.log("hearth-saver: care frame on, kind " + kindOf(l[0]));
        }
    }

    // B6: the video item IS the picture. Its size is the video's picture rectangle (Fit: the video's aspect inside the layer, from metaData.resolution,
    // 16:9 until known; Fill: the whole layer, cropped by the player), centred in the layer, fillMode Stretch for Fit (no letterbox inside the plane),
    // and the PunchThrough hole is exactly the item. Item, hole and picture are one rectangle, as in the case that was always clean (Fill, no care frame).
    // The bars of Fit are the opaque black base (B2) around it. This replaces the B3 hole sizing and the B5 24 px workaround.
    // The video is one pixel short of the layer's height (the TV needs it). The black veil fades out once, at the first start only.
    function videoQml(version, loop) {
        return 'import QtQuick 2.4; import QtMultimedia ' + version + '; import Eos.Items 0.1; import WebOS.Global 1.0; Video { id: v; fillMode: ' + (fill ? 'VideoOutput.PreserveAspectCrop' : 'VideoOutput.Stretch') + '; property bool crop: ' + (fill ? 'true' : 'false') + '; property real ar: (metaData.resolution && metaData.resolution.width > 0 && metaData.resolution.height > 0) ? metaData.resolution.width / metaData.resolution.height : 1.7778; property int ph: crop ? parent.height - 1 : Math.round(Math.min(parent.height - 1, parent.width / ar)); property int pw: crop ? parent.width : Math.round(Math.min(parent.width, ph * ar)); width: pw; height: ph; x: Math.floor((parent.width - pw) / 2); y: Math.floor((parent.height - ph) / 2); volume: 0; autoPlay: true; ' + (loop ? 'loops: MediaPlayer.Infinite; ' : '') + 'onPlaying: { if (!hole.visible) { hole.visible = true; veilIn.running = true; } parent.vstatus(true, false, false, v); } onStatusChanged: parent.vstatus(false, status === MediaPlayer.EndOfMedia, status === MediaPlayer.InvalidMedia, v); onPaused: parent.vstatus(false, true, false, v); onErrorChanged: if (error !== 0) parent.vfail(errorString, v); PunchThrough { id: hole; visible: false; z: -1; x: 0; y: 0; width: v.width; height: v.height; Rectangle { id: veil; x: -v.x; y: -v.y; width: 1920; height: 1080; z: 1; color: "black"; OpacityAnimator { id: veilIn; target: veil; from: 1; to: 0; duration: 1500; running: false } } } }';
    }

    // A lone video loops by the player itself (QtMultimedia 5.8 or later: loops); older Qt: restarted from videoEnded().
    function makeVideo(parentLayer) {
        if (list.length === 1) {
            try { return Qt.createQmlObject(videoQml("5.8", true), parentLayer, "hearthVideo"); }
            catch (e) { console.log("hearth-saver: no player loop here: " + e); }
        }
        return Qt.createQmlObject(videoQml("5.6", false), parentLayer, "hearthVideo");
    }

    property int fails: 0
    property string note: ""

    // --- Aerial (filled in by screensaver.sh) ---------------------------------------------------------------------------
    property bool aerial: __AERIAL_ON__
    property string aerialBase: "__AERIAL_BASE__"
    // feeds to play: apple, amazon, jetson, robin (empty = all)
    property var aerialSources: [__AERIAL_SOURCES__]
    // hd (Full HD), uhd (4K SDR), hdr (4K HDR / Dolby Vision; a clip without one plays its 4K SDR)
    property string aerialQuality: "__AERIAL_QUALITY__"
    property bool aerialText: __AERIAL_TEXT__ === 1
    property string aerialLang: "__AERIAL_LANG__"
    // true while Aerial plays; false once it has fallen back to the photos
    property bool aerialActive: aerial
    property var aerialList: []
    property var aerialNames: ({})
    property var aerialSeen: ({})
    property int aerialAt: -1
    property int aerialFails: 0
    property var aerialVideo: null
    property bool aerialPending: false
    property bool aerialEnding: false
    property bool aerialDecided: false
    property var aerialCheck: null
    property real aerialLastPos: -1
    property int aerialStuck: 0
    property string placeName: ""
    property string placeText: ""
    // OLED care for the place names: they drift with the same slow steps as the care frame (+-12 px across, +-9 px down)
    property int textDx: careMode > 0 ? 3 * tri(driftStep, 4) : 0
    property int textDy: careMode > 0 ? 3 * tri(driftStep, 3) : 0

    function loadJson(url, done) {
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            var data = null;
            // a local file answers 0 on some Qt versions, 200 on others
            if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
                try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
            }
            done(data);
        };
        xhr.open("GET", url);
        xhr.send();
    }

    // the URL for the chosen quality; the fall-backs (Full HD to 4K SDR, HDR to 4K SDR) are in the list already
    function aerialUrl(a) {
        if (aerialQuality === "hdr" && a.hdr) return a.hdr;
        if (aerialQuality === "hd") return a.hd || a.uhd || "";
        return a.uhd || a.hd || "";
    }

    function aerialStart() {
        loadJson(aerialBase + "videos.json", function (feed) {
            var l = [];
            var all = aerialSources.length === 0;
            if (feed && feed.assets) {
                for (var i = 0; i < feed.assets.length; i++) {
                    var a = feed.assets[i];
                    if ((all || aerialSources.indexOf(a.s) !== -1) && aerialUrl(a) !== "") l.push(a);
                }
            }
            if (l.length === 0) { aerialFallback("no clips in the list"); return; }
            aerialList = l;
            loadJson(aerialBase + "strings-" + aerialLang + ".json", function (names) {
                if (names || aerialLang === "en") { aerialNames = names || {}; aerialCheckDecoder(); return; }
                loadJson(aerialBase + "strings-en.json", function (en) { aerialNames = en || {}; aerialCheckDecoder(); });
            });
        });
    }

    // A paused video in another app (YouTube, Netflix...) keeps its hardware decoder; if ours took it, that app could not
    // resume. So when the TV says a decoder is connected, the photos play instead of video. (The check is the one
    // custom-screensaver-aerial uses. A TV without it, or no answer in 3 s, plays video: the check is not known to work
    // on every webOS version, and a saver that never plays video would be worse.)
    function aerialCheckDecoder() {
        try {
            aerialCheck = Qt.createQmlObject('import QtQuick 2.4; import WebOSServices 1.0; Service { property var done: null; service: "com.webos.service.videooutput"; method: "getStatus"; onCallResponse: if (done) done((typeof response === "string") ? response : JSON.stringify(response)); onCallFailure: if (done) done(""); }', win, "hearthDecoder");
        } catch (e) { console.log("hearth-saver: no decoder check here: " + e); aerialCheck = null; }
        if (!aerialCheck) { aerialDecide(false); return; }
        aerialCheck.appId = win.appId;
        aerialCheck.done = function (text) { aerialDecide(/"connectedSource" *: *"VDEC/.test(text)); };
        decoderWait.start();
        try { aerialCheck.callService({}); } catch (e2) { console.log("hearth-saver: decoder check failed: " + e2); aerialDecide(false); }
    }

    function aerialDecide(held) {
        if (aerialDecided) return;
        aerialDecided = true;
        decoderWait.stop();
        if (held) aerialFallback("another app holds the video decoder");
        else aerialNext();
    }

    // a random clip not shown yet in this round, never the same one twice in a row
    function aerialPick() {
        var open = [];
        var i;
        for (i = 0; i < aerialList.length; i++) if (!aerialSeen[aerialList[i].id]) open.push(i);
        if (open.length === 0) {
            aerialSeen = ({});
            for (i = 0; i < aerialList.length; i++) open.push(i);
        }
        if (open.length > 1 && aerialAt !== -1) open = open.filter(function (n) { return n !== aerialAt; });
        return open[Math.floor(Math.random() * open.length)];
    }

    // The player is let go completely (stopped, source cleared, destroyed), so the decoder is free at once.
    function aerialDrop() {
        var v = aerialVideo;
        aerialVideo = null;
        aerialPending = false;
        aerialWatch.stop();
        if (!v) return;
        try { v.stop(); v.source = ""; } catch (e) {}
        v.destroy();
    }

    function aerialNext() {
        if (!aerialActive) return;
        aerialDrop();
        aerialEnding = false;
        aerialLastPos = -1;
        aerialStuck = 0;
        veilOut.stop(); veilIn.stop(); aerialVeil.opacity = 1;
        textIn.stop(); textOut.stop(); placeBox.opacity = 0;
        aerialAt = aerialPick();
        var a = aerialList[aerialAt];
        placeName = aerialNames[a.n] || "";
        placeText = "";
        try {
            aerialVideo = Qt.createQmlObject(videoQml("5.6", false), aerialLayer, "hearthAerial");
            aerialPending = true;
            aerialVideo.source = aerialUrl(a);
            aerialWatch.restart();
        } catch (e) { aerialVideo = null; aerialFail("video: " + e, null); }
    }

    function aerialStatus(playing, ended, bad, who) {
        if (!aerialActive || who !== aerialVideo) return;
        if (playing && aerialPending) {
            aerialPending = false;
            aerialFails = 0;
            aerialWatch.stop();
            aerialSeen[aerialList[aerialAt].id] = true;
            veilIn.restart();
            if (aerialText) textIn.restart();
        } else if (ended && !aerialPending) aerialNext();
        else if (bad) aerialFail("invalid media", who);
    }

    // A clip that does not play is skipped; five in a row (no network, or this TV cannot play that kind) and the photos play.
    function aerialFail(why, who) {
        if (!aerialActive || (who && who !== aerialVideo)) return;
        aerialFails++;
        note = "aerial: " + why;
        console.log("hearth-saver: aerial clip failed: " + why);
        if (aerialFails >= 5) aerialFallback("clips did not play (" + why + ")");
        else aerialNext();
    }

    function aerialFallback(why) {
        console.log("hearth-saver: aerial off, photos instead: " + why);
        aerialDrop();
        aerialActive = false;
        note = "aerial: " + why + "; photos instead";
        prepare();
        next();
    }

    // every second: the place name for this moment of the clip, the fade to black before its end, and a stalled stream
    function aerialTick() {
        var v = aerialVideo;
        if (!aerialActive || !v || aerialPending) return;
        var pos = v.position;
        var dur = v.duration;
        var a = aerialList[aerialAt];
        var sec = Math.floor(pos / 1000);
        var best = -1;
        for (var t in a.p) {
            var n = parseInt(t, 10);
            if (n <= sec && n > best) best = n;
        }
        placeText = best >= 0 ? (aerialNames[a.p[String(best)]] || "") : "";
        if (!aerialEnding && dur > 8000 && pos >= dur - 5000) {
            aerialEnding = true;
            veilIn.stop(); veilOut.restart();
            textIn.stop(); if (aerialText) textOut.restart();
        }
        if (pos === aerialLastPos) {
            aerialStuck++;
            if (aerialStuck >= 25) aerialFail("stalled for 25 s", v);
        } else {
            aerialStuck = 0;
            aerialLastPos = pos;
        }
    }

    function kindOf(url) {
        if (/\.gif$/i.test(url)) return "gif";
        if (/\.(mp4|m4v|mov|mkv|webm)$/i.test(url)) return "video";
        return "image";
    }

    function next() {
        if (list.length === 0) return;
        at = (at + 1) % order.length;
        var url = list[order[at]];
        var target = frontIsA ? layerB : layerA;
        var other = frontIsA ? layerA : layerB;
        // the incoming layer is set to 0 at once, then fades in over the old one (which stays solid underneath until the fade is done)
        target.fadeOut();
        target.z = 2;
        other.z = 1;
        target.show(url);
        frontIsA = !frontIsA;
        // a picture or GIF stays for the interval; a video plays to its end (see videoEnded)
        if (kindOf(url) === "video") slide.stop();
        else if (list.length > 1) slide.restart();
    }

    // A picture that cannot be read or a video that cannot be played is skipped (not forever: at most one round of failures).
    function failed() {
        fails++;
        if (list.length > 1 && fails <= list.length) next();
    }

    // A video has played to its end: on to the next item; a lone video starts again.
    function videoEnded() {
        if (list.length > 1) { next(); return; }
        var l = frontIsA ? layerA : layerB;
        l.over = false;
        if (l.vobj) { l.vobj.seek(0); l.vobj.play(); }
    }

    Component.onCompleted: {
        if (aerial) aerialStart();
        else {
            prepare();
            next();
        }
    }

    // The TV closes the saver on any key: every player is stopped and its source cleared, so the decoder goes back to
    // the app that comes next (the app's process ends too, which frees it in any case).
    Component.onDestruction: {
        aerialDrop();
        layerA.dropVideo();
        layerB.dropVideo();
    }

    Timer {
        id: decoderWait
        interval: 3000
        onTriggered: win.aerialDecide(false)
    }
    Timer {
        id: aerialWatch
        interval: 25000
        onTriggered: if (win.aerialPending) win.aerialFail("did not start in 25 s", win.aerialVideo)
    }
    Timer {
        id: aerialClock
        interval: 1000
        repeat: true
        running: win.aerialActive && win.aerialVideo !== null
        onTriggered: win.aerialTick()
    }

    // The drift: one small step about every minute (only while a frame is on).
    Timer {
        id: drift
        interval: 60000
        repeat: true
        running: win.frame > 0 || (win.aerialActive && win.aerialText && win.careMode > 0)
        onTriggered: { win.driftAnimated = true; win.driftStep = win.driftStep + 1; }
    }

    Timer {
        id: slide
        interval: win.intervalSec * 1000
        repeat: true
        onTriggered: win.next()
    }

    Item {
        id: layerA
        property bool pending: false
        property string kind: "image"
        property var vobj: null
        x: win.offX
        y: win.offY
        width: win.width - 2 * win.frame
        height: win.height - 2 * win.frame
        opacity: 0
        clip: true   // Fill crops inside the layer
        // the fade-in is an explicit animation (fade A or B), started when the item is ready; the layer is set to 0 at once before a new item
        NumberAnimation { id: fadeA; target: layerA; property: "opacity"; from: 0; to: 1; duration: 1500; easing.type: Easing.InOutQuad }
        function fadeOut() { fadeA.stop(); opacity = 0; }
        function appear() { fadeA.restart(); }
        Behavior on x { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        Behavior on y { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        function show(url) {
            pending = true;
            over = false;
            kind = win.kindOf(url);
            dropVideo();
            stillA.source = "";
            movieA.playing = false;
            movieA.source = "";
            if (kind === "gif") movieA.source = url;
            else if (kind === "video") startVideo(url);
            else stillA.source = url;
        }
        function dropVideo() { var v = vobj; vobj = null; if (v) { v.stop(); v.source = ""; v.destroy(); } }
        function clear() { stillA.source = ""; movieA.source = ""; dropVideo(); }
        // The video element is made only when a video is shown (and inside try): if the TV has no QtMultimedia, videos are skipped and nothing else is affected.
        function startVideo(url) {
            try {
                vobj = win.makeVideo(layerA);
                vobj.source = url;
            watchA.restart();
            } catch (e) { win.note = "video: " + e; vobj = null; pending = false; win.failed(); }
        }
        property bool over: false
        function vstatus(playing, ended, bad) {
            if (kind !== "video") return;
            if (playing && pending) { pending = false; win.fails = 0; appear(); clearOther.restart(); watchA.stop(); }
            else if (ended && !pending && !over) { over = true; win.videoEnded(); }
            else if (bad) vfail("invalid media");
        }
        function vfail(why) { if (kind === "video" && pending) { win.note = "video: " + why; pending = false; dropVideo(); win.failed(); } }
        function ready(status) {
            if (status === Image.Ready && pending) { pending = false; win.fails = 0; appear(); if (kind === "gif") movieA.playing = true; clearOther.restart(); }
            else if (status === Image.Error && pending) { pending = false; win.failed(); }
        }
        Timer {
            id: watchA
            interval: 10000
            onTriggered: if (layerA.pending && layerA.kind === "video") layerA.vfail("did not start in 10 s")
        }
        // black behind a picture or GIF, so the old picture cannot show through the bars of the new one while it fades in
        Rectangle { anchors.fill: parent; z: -1; color: "black"; visible: layerA.kind !== "video" }
        Image {
            id: stillA
            anchors.fill: parent
            fillMode: win.fill ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            asynchronous: true
            autoTransform: true
            cache: false
            smooth: true
            sourceSize.width: 1920
            sourceSize.height: 1080
            onStatusChanged: if (layerA.kind === "image") layerA.ready(status)
        }
        AnimatedImage {
            id: movieA
            anchors.fill: parent
            fillMode: win.fill ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            asynchronous: true
            cache: false
            playing: false
            onStatusChanged: if (layerA.kind === "gif") layerA.ready(status)
        }
    }

    Item {
        id: layerB
        property bool pending: false
        property string kind: "image"
        property var vobj: null
        x: win.offX
        y: win.offY
        width: win.width - 2 * win.frame
        height: win.height - 2 * win.frame
        opacity: 0
        clip: true   // Fill crops inside the layer
        // the fade-in is an explicit animation (fade A or B), started when the item is ready; the layer is set to 0 at once before a new item
        NumberAnimation { id: fadeB; target: layerB; property: "opacity"; from: 0; to: 1; duration: 1500; easing.type: Easing.InOutQuad }
        function fadeOut() { fadeB.stop(); opacity = 0; }
        function appear() { fadeB.restart(); }
        Behavior on x { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        Behavior on y { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        function show(url) {
            pending = true;
            over = false;
            kind = win.kindOf(url);
            dropVideo();
            stillB.source = "";
            movieB.playing = false;
            movieB.source = "";
            if (kind === "gif") movieB.source = url;
            else if (kind === "video") startVideo(url);
            else stillB.source = url;
        }
        function dropVideo() { var v = vobj; vobj = null; if (v) { v.stop(); v.source = ""; v.destroy(); } }
        function clear() { stillB.source = ""; movieB.source = ""; dropVideo(); }
        // The video element is made only when a video is shown (and inside try): if the TV has no QtMultimedia, videos are skipped and nothing else is affected.
        function startVideo(url) {
            try {
                vobj = win.makeVideo(layerB);
                vobj.source = url;
            watchB.restart();
            } catch (e) { win.note = "video: " + e; vobj = null; pending = false; win.failed(); }
        }
        property bool over: false
        function vstatus(playing, ended, bad) {
            if (kind !== "video") return;
            if (playing && pending) { pending = false; win.fails = 0; appear(); clearOther.restart(); watchB.stop(); }
            else if (ended && !pending && !over) { over = true; win.videoEnded(); }
            else if (bad) vfail("invalid media");
        }
        function vfail(why) { if (kind === "video" && pending) { win.note = "video: " + why; pending = false; dropVideo(); win.failed(); } }
        function ready(status) {
            if (status === Image.Ready && pending) { pending = false; win.fails = 0; appear(); if (kind === "gif") movieB.playing = true; clearOther.restart(); }
            else if (status === Image.Error && pending) { pending = false; win.failed(); }
        }
        Timer {
            id: watchB
            interval: 10000
            onTriggered: if (layerB.pending && layerB.kind === "video") layerB.vfail("did not start in 10 s")
        }
        // black behind a picture or GIF, so the old picture cannot show through the bars of the new one while it fades in
        Rectangle { anchors.fill: parent; z: -1; color: "black"; visible: layerB.kind !== "video" }
        Image {
            id: stillB
            anchors.fill: parent
            fillMode: win.fill ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            asynchronous: true
            autoTransform: true
            cache: false
            smooth: true
            sourceSize.width: 1920
            sourceSize.height: 1080
            onStatusChanged: if (layerB.kind === "image") layerB.ready(status)
        }
        AnimatedImage {
            id: movieB
            anchors.fill: parent
            fillMode: win.fill ? Image.PreserveAspectCrop : Image.PreserveAspectFit
            asynchronous: true
            cache: false
            playing: false
            onStatusChanged: if (layerB.kind === "gif") layerB.ready(status)
        }
    }

    // Aerial: the player's layer (the whole screen, no care frame: the picture keeps moving), a black veil over it for the
    // fade through black between clips, and the place names.
    Item {
        id: aerialLayer
        z: 2
        x: 0
        y: 0
        width: win.width
        height: win.height
        visible: win.aerialActive
        function vstatus(playing, ended, bad, who) { win.aerialStatus(playing, ended, bad, who); }
        function vfail(why, who) { win.aerialFail(why, who); }
    }
    Rectangle {
        id: aerialVeil
        z: 3
        anchors.fill: parent
        color: "black"
        opacity: 1
        visible: win.aerialActive
        NumberAnimation { id: veilIn; target: aerialVeil; property: "opacity"; to: 0; duration: 3000; easing.type: Easing.InOutQuad }
        NumberAnimation { id: veilOut; target: aerialVeil; property: "opacity"; to: 1; duration: 4500; easing.type: Easing.InOutQuad }
    }
    Column {
        id: placeBox
        z: 5
        visible: win.aerialActive && win.aerialText
        opacity: 0
        spacing: 4
        x: 65 + win.textDx
        y: win.height - 65 - height + win.textDy
        Behavior on x { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        Behavior on y { enabled: win.driftAnimated; NumberAnimation { duration: 3000 } }
        NumberAnimation { id: textIn; target: placeBox; property: "opacity"; to: 0.8; duration: 3000 }
        NumberAnimation { id: textOut; target: placeBox; property: "opacity"; to: 0; duration: 4000 }
        Text {
            visible: text !== ""
            width: 1700
            elide: Text.ElideRight
            text: win.placeName
            color: "white"
            font.pixelSize: 56
            style: Text.Raised
            styleColor: "black"
        }
        Text {
            visible: text !== ""
            width: 1700
            elide: Text.ElideRight
            text: win.placeText
            color: "white"
            font.pixelSize: 40
            style: Text.Raised
            styleColor: "black"
        }
    }

    // After the cross-fade the picture underneath is not needed: stop it and free its memory.
    Timer {
        id: clearOther
        interval: 2000
        onTriggered: (win.frontIsA ? layerB : layerA).clear()
    }

    // Dim: a black layer over the picture (dimlevel % opacity, 40 = about 60% brightness). It dims what is drawn, not the TV's backlight;
    // whether it also dims a video (drawn on the TV's video plane) is not known yet.
    Rectangle {
        z: 10
        anchors.fill: parent
        color: "black"
        opacity: __DIMLEVEL__ / 100
        visible: win.dim
    }

    // A video problem is shown for a while in a corner (for reports); nothing else is ever drawn over the pictures.
    Text {
        z: 20
        x: 40
        y: win.aerialActive ? 40 : 1020   // Aerial: the place names are at the bottom
        visible: win.note !== ""
        text: win.note
        color: "white"
        opacity: 0.6
        font.pixelSize: 24
        onTextChanged: noteOff.restart()
    }
    Timer { id: noteOff; interval: 20000; onTriggered: win.note = "" }
}
