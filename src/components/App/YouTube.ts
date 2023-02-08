import { Player } from './Player';
import querystring from 'querystring';

export class YouTube implements Player {
  watchPartyYTPlayer: any | null;
  constructor(watchPartyYTPlayer: any) {
    this.watchPartyYTPlayer = watchPartyYTPlayer;
  }
  getCurrentTime = () => {
    return this.watchPartyYTPlayer?.getCurrentTime() ?? 0;
  };

  getDuration = () => {
    return this.watchPartyYTPlayer?.getDuration() ?? 0;
  };

  isMuted = () => {
    return this.watchPartyYTPlayer?.isMuted() ?? false;
  };

  isSubtitled = (): boolean => {
    // This actually isn't accurate after subtitles have been toggled off because track doesn't update
    // try {
    //   const current = this.watchPartyYTPlayer?.getOption('captions', 'track');
    //   return Boolean(current && current.languageCode);
    // } catch (e) {
    //   console.warn(e);
    //   return false;
    // }
    return false;
  };

  getPlaybackRate = (): number => {
    return this.watchPartyYTPlayer?.getPlaybackRate() ?? 1;
  };

  setPlaybackRate = (rate: number) => {
    this.watchPartyYTPlayer?.setPlaybackRate(rate);
  };

  setSrcAndTime = async (src: string, time: number) => {
    let url = new window.URL(src);
    // Standard link https://www.youtube.com/watch?v=ID
    let videoId = querystring.parse(url.search.substring(1))['v'];
    // Link shortener https://youtu.be/ID
    let altVideoId = src.split('/').slice(-1)[0];
    this.watchPartyYTPlayer?.cueVideoById(videoId || altVideoId, time);
  };

  playVideo = async () => {
    setTimeout(() => {
      console.log('play yt');
      this.watchPartyYTPlayer?.playVideo();
    }, 200);
  };

  pauseVideo = () => {
    this.watchPartyYTPlayer?.pauseVideo();
  };

  seekVideo = (time: number) => {
    this.watchPartyYTPlayer?.seekTo(time, true);
  };

  shouldPlay = () => {
    return (
      this.watchPartyYTPlayer?.getPlayerState() ===
        window.YT?.PlayerState.PAUSED ||
      this.getCurrentTime() === this.getDuration()
    );
  };

  setMute = (muted: boolean) => {
    if (muted) {
      this.watchPartyYTPlayer?.mute();
    } else {
      this.watchPartyYTPlayer?.unMute();
    }
  };

  setVolume = (volume: number) => {
    this.watchPartyYTPlayer?.setVolume(volume * 100);
  };

  getVolume = (): number => {
    const volume = this.watchPartyYTPlayer?.getVolume();
    return volume / 100;
  };

  showSubtitle = () => {
    // YouTube doesn't use the subtitle modal
    return;
  };

  setSubtitleMode = (mode?: TextTrackMode, lang?: string) => {
    // Show the available options
    // console.log(this.watchPartyYTPlayer?.getOptions('captions'));
    if (mode === 'showing') {
      console.log(lang);
      this.watchPartyYTPlayer?.setOption('captions', 'reload', true);
      this.watchPartyYTPlayer?.setOption('captions', 'track', {
        languageCode: lang ?? 'en',
      });
    }
    if (mode === 'hidden') {
      // BUG this doesn't actually set the value of track
      // so we can't determine if subtitles are on or off
      // need to provide separate menu options
      this.watchPartyYTPlayer?.setOption('captions', 'track', {});
    }
  };

  getSubtitleMode = () => {
    return 'hidden' as TextTrackMode;
  };

  isReady = () => {
    return Boolean(this.watchPartyYTPlayer);
  };

  stopVideo = () => {
    this.watchPartyYTPlayer?.stopVideo();
  };
}
