registerPlugin({
	name: 'YouTube Playlist',
	version: '1.0.0',
	description: 'Enables the playback of YouTube playlists with !ytpl',
	author: 'Irame',
	vars: {
		apiKey: {
			title: 'API KEY (https://console.developers.google.com/project)',
			type: 'string'
		}
	}
	
}, function(sinusbot, config) {
	var playlistRequestUrlPattern = "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=1&playlistId={playlist_id}&pageToken={page_token}&key={api_key}";
	var videosRequestUrlPattern = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id={video_id}&key={api_key}"
	var youtubeVideoUrlPattern = "https://youtu.be/{video_id}";
	var youtubeUrlPlaylistRegex = /list=([a-zA-Z0-9_-]*)/;
	
	if (!String.prototype.format) {
		String.prototype.format = function() {
			var str = this.toString();
			if (!arguments.length) {
				return str;
			}
			var args = typeof arguments[0],
				args = (("string" == args || "number" == args) ? arguments : arguments[0]);
			for (arg in args) {
				str = str.replace(RegExp("\\{" + arg + "\\}", "gi"), args[arg]);
			}
			return str;
		}
	}
	
	function send_msg(msg, ev) {
		var mode = (typeof ev !== 'undefined') ? ev.mode : 2;
		switch (mode) {
			case 1:
				sinusbot.chatPrivate(ev.clientId, msg);
				break;
			case 2:
				sinusbot.chatChannel(msg);
				break;
			default:
				sinusbot.chatServer(msg);
				break;
		}
	}
	
	function setMode(mode) {
		if (mode) {
			sinusbot.setVarInstance("ytpl_mode", mode);
		} else {
			sinusbot.unsetVarInstance("ytpl_mode");
		}
	}
	
	function getMode() {
		return sinusbot.getVarInstance("ytpl_mode");
	}
	
	function setNextPageToken(nextPageToken) {
		if (nextPageToken) {
			sinusbot.setVarInstance("ytpl_nextPageToken", nextPageToken);
		} else {
			sinusbot.unsetVarInstance("ytpl_nextPageToken");
		}
	}
	
	function getNextPageToken() {
		return sinusbot.getVarInstance("ytpl_nextPageToken");
	}
	
	function setCurrentTitle(title) {
		if (title) {
			sinusbot.setVarInstance("ytpl_currentTitle", title);
		} else {
			sinusbot.unsetVarInstance("ytpl_currentTitle");
		}
	}
	
	function getCurrentTitle() {
		return sinusbot.getVarInstance("ytpl_currentTitle");
	}
	
	function setCurrentPlaylist(playlist) {
		if (playlist) {
			send_msg("Start playback of playlist with id: " + playlist);
			sinusbot.setVarInstance("ytpl_currentPlaylist", playlist);
		} else {
			send_msg("Stop playback of playlist with id: " + sinusbot.getVarInstance("ytpl_currentPlaylist"));
			sinusbot.unsetVarInstance("ytpl_currentPlaylist");
		}
		setNextPageToken();
		setCurrentTitle();
	}
	
	function getCurrentPlaylist() {
		return sinusbot.getVarInstance("ytpl_currentPlaylist");
	}
	
	function playVideoById(id) {
		var videoUrl = youtubeVideoUrlPattern.format({video_id: id});
		switch (getMode()) {
			case 'play':
				sinusbot.yt(videoUrl);
				setMode('queue');
				break;
			case 'queue':
				sinusbot.qyt(videoUrl);
				break;
			case 'download':
				sinusbot.ytdl(videoUrl);
				requestNextPlaylistVideo();
				break;
		}
	}
	
	function processVideoReqeust(err, res) {
		if (err) {
			send_msg("API Video Request error");
			sinusbot.log(err);
		} else {
			if (res.statusCode == 200) {
				var data = JSON.parse(res.data);
				
				if (data.items && data.items.length > 0) {
					var item = data.items[0];
					if (item.id 
						&& item.snippet && item.snippet.title
						&& item.contentDetails 
						&& !(item.contentDetails.regionRestriction 
							&& item.contentDetails.regionRestriction.blocked 
							&& ("DE" in item.contentDetails.regionRestriction.blocked)))
					{
						setCurrentTitle(item.snippet.title);
						playVideoById(item.id);
					}
				}
			} else {
				send_msg("Video Request failed (Bad request)");
				sinusbot.log("(Bad request) StatusCode: " + res.statusCode + "; PlaylistId: " + getCurrentPlaylist() + "; PageToken: " + getNextPageToken());
			}
		}
	}
	
	function requestVideo(videoId) {
		sinusbot.http({
			method: "GET",
			url: videosRequestUrlPattern.format({
				api_key: config.apiKey,
				video_id: videoId
			}),
			headers: {
				"Content-Type": "application/json; charset=UTF-8"
			}
		}, processVideoReqeust);
	}
	
	function processPlaylistRequest(err, res) {
		if (err) {
			send_msg("API Playlist Request error");
			sinusbot.log(err);
		} else {
			if (res.statusCode == 200) {
				var data = JSON.parse(res.data);
				
				var items = data.items;
				if (!items || items.length < 0) {
					send_msg("Playlist request failed (Items empty)")
					sinusbot.log("(Items empty) PlaylistId: " + getCurrentPlaylist() + "; PageToken: " + getNextPageToken());
					setCurrentPlaylist();
					return;
				}
				
				var nextPageToken = data.nextPageToken;
				
				var item = items[0];
				if (item.status.privacyStatus == "private") {
					sinusbot.log("(Skipped item) PlaylistId: " + getCurrentPlaylist() + "; PageToken: " + getNextPageToken());
					requestPlaylistVideoByPage(getCurrentPlaylist(), nextPageToken);
					return;
				}
				
				setNextPageToken(nextPageToken);
				
				var videoId = item.snippet.resourceId.videoId;
				requestVideo(videoId);
			} else {
				send_msg("Playlist request failed (Bad request)");
				sinusbot.log("(Bad request) StatusCode: " + res.statusCode + "; PlaylistId: " + getCurrentPlaylist() + "; PageToken: " + getNextPageToken());
			}
		}
	}
	
	function requestPlaylistVideoByPage(playlistId, pageToken) {
		if (!pageToken) pageToken = "";
		sinusbot.http({
			method: "GET",
			url: playlistRequestUrlPattern.format({
				api_key: config.apiKey,
				playlist_id: playlistId,
				page_token: pageToken
			}),
			headers: {
				"Content-Type": "application/json; charset=UTF-8"
			}
		}, processPlaylistRequest);
	}
	
	function requestNextPlaylistVideo() {
		if (!getCurrentPlaylist()) return;
		var nextPageToken = getNextPageToken();
		if (nextPageToken) {
			requestPlaylistVideoByPage(getCurrentPlaylist(), getNextPageToken());
		} else {
			setCurrentPlaylist();
		}
	}
	
	function getPlaylistIdFromUrl(url) {
		var r = url.match(youtubeUrlPlaylistRegex);
		if (r) return r[1];
	}
	
	sinusbot.on('chat', function(ev) {
		var args = ev.msg.split(' ');
		var mode;
		switch(args[0]) {
			case '!ytpl':
				mode = "play";
				break;
			case '!qytpl':
				mode  = "queue";
				break;
			case '!ytpldl':
				mode = "download";
				break;
			default:
				return;
		}
		
		if (args[1] == "stop") {
			setCurrentPlaylist();
		} else {
			var playlistId = getPlaylistIdFromUrl(args[1]);
			if (playlistId) {
				setMode(mode);
				setCurrentPlaylist(playlistId);
				requestPlaylistVideoByPage(playlistId);
			} else {
				send_msg("No PlaylistId found in URL!", ev);
			}
		}
	});
	
	sinusbot.on("track", function(ev) {
		if (ev.title == getCurrentTitle()) {
			requestNextPlaylistVideo();
		}
	});
});