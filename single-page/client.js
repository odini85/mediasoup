import * as config from "./config";
import * as mediasoup from "mediasoup-client";
import deepEqual from "deep-equal";
import debugModule from "debug";

const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);
const log = debugModule("demo-app");
const warn = debugModule("demo-app:WARN");
const err = debugModule("demo-app:ERROR");

/**
 * 호출 상태를 관리하기 위해 내부적으로 사용하는 모든 참조를 내보냅니다.
 * js 콘솔에서 쉽게 수정할 수 있도록 합니다.
 * 예:  `Client.camVideoProducer.paused`
 */

/**
 * 나의 Peer Id
 */
export const myPeerId = uuidv4();

/** 디바이스 인스턴스 - new mediasoup.Device() 결과 */
export let device;
/** 회의 참석중 여부 */
export let joined;
/** 로컬 카메라 */
export let localCam;
/** 공유용 로컬 스크린 */
export let localScreen;
export let recvTransport;
/** 트랜스포트 전송 */
export let sendTransport;
/** 카메라 프로듀서 - sendTransport.produce 를 통해 생성 */
export let camVideoProducer;
/** 오디오 프로듀서 - sendTransport.produce 를 통해 생성 */
export let camAudioProducer;
export let screenVideoProducer;
export let screenAudioProducer;
/** 현재 활성화된 스피커 */
export let currentActiveSpeaker = {};
/** 마지막 폴링으로 동기화된 피어 데이터 */
export let lastPollSyncData = {};
export let consumers = [];
/** 폴링 인터벌 아이디 */
export let pollingInterval;

/**
 * @title 엔트리 포인트
 * @description document.body.onload 시점 호출
 * @returns
 */
export async function main() {
  console.log(`starting up ... my peerId is ${myPeerId}`);
  try {
    device = new mediasoup.Device();
  } catch (e) {
    if (e.name === "UnsupportedError") {
      console.error("browser not supported for video calls");
      return;
    } else {
      console.error(e);
    }
  }

  window.addEventListener("unload", () => {
    // unload 이벤트에 연결 끊김 여부를 서버에 알려준다.
    sig("leave", {}, true);
  });
}

/**
 * @title 방 입장
 * @description 회의를 제어한다.
 * @returns
 */
export async function joinRoom() {
  // 방에 입장된 상태는 더 이상 진행하지 않음
  if (joined) {
    return;
  }

  log("join room");
  // 방 입장 UI 숨김
  $("#join-control").style.display = "none";

  try {
    // 새로운 피어임을 알린다.
    const { routerRtpCapabilities } = await sig("join-as-new-peer");
    // mediasoup-client device가 로드되지 않은 경우(처음 연결)
    if (!device.loaded) {
      // 디바이스를 초기화(로드) 한다.
      await device.load({ routerRtpCapabilities });
    }
    // 방 입장 상태로 변경
    joined = true;
    // 방 퇴장 UI 노출
    $("#leave-room").style.display = "initial";
  } catch (e) {
    console.error(e);
    return;
  }

  console.log("polling");

  // 1초 간격 폴링(인터벌)
  pollingInterval = setInterval(async () => {
    console.log("interval!");
    let { error } = await pollAndUpdate();
    // 에러가 있다면 오류
    if (error) {
      // 인터벌 종료
      clearInterval(pollingInterval);
      // 디버그 - 로깅
      err(error);
    }
  }, 1000);
}

/**
 * @title 카메라 스트림 전송
 */
export async function sendCameraStreams() {
  log("send camera streams");
  $("#send-camera").style.display = "none";

  /**
   * 방에 참여하고 카메라가 시작되었는지 확인한다.
   * 이미 호출된 함수는 아무것도 하지 않는다.
   */
  await joinRoom();
  await startCamera();

  // sendTransport가 없다면 sendTransport 생성
  if (!sendTransport) {
    sendTransport = await createTransport("send");
  }

  /*
    비디오 전송을 시작한다.
    전송 로직은 카메라 비디오 트랙에 대한 아웃바운드 rtp 스트림을 설정하기 위해 서버와 신호 대화를 시작합니다.
    createTransport() 함수에는 UI의 체크박스가 체크가 안된 경우 일시 중지된 상태에서 스트림을 시작하도록 서버에 요청하는 로직이 포함되어 있다.
    따라서 클라이언트 측 camVideoProducer 개체가 있다면 적절하게 일시 중지되도록 설정되어야 한다.
  */
  camVideoProducer = await sendTransport.produce({
    track: localCam.getVideoTracks()[0],
    encodings: camEncodings(),
    appData: { mediaTag: "cam-video" },
  });
  // 카메라가 멈춤 상태인 경우
  if (getCamPausedState()) {
    try {
      // camVideoProducer 멈춤
      await camVideoProducer.pause();
    } catch (e) {
      console.error(e);
    }
  }

  // 오디오도 이미 생성되어 있다면 동일하게 처리한다.
  camAudioProducer = await sendTransport.produce({
    track: localCam.getAudioTracks()[0],
    appData: { mediaTag: "cam-audio" },
  });
  // 마이크가 멈춤 상태인 경우
  if (getMicPausedState()) {
    try {
      //  camAudioProducer 멈춤
      camAudioProducer.pause();
    } catch (e) {
      console.error(e);
    }
  }

  $("#stop-streams").style.display = "initial";
  showCameraInfo();
}

/**
 * @title 화면 공유 시작
 */
export async function startScreenshare() {
  log("start screen share");
  $("#share-screen").style.display = "none";

  // 방 참여 여부와 sendTransport가 있는지 확인한다.
  await joinRoom();
  if (!sendTransport) {
    sendTransport = await createTransport("send");
  }

  // 공유용 로컬 스크린
  localScreen = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  // 비디오 producer 생성
  screenVideoProducer = await sendTransport.produce({
    track: localScreen.getVideoTracks()[0],
    encodings: screenshareEncodings(),
    appData: { mediaTag: "screen-video" },
  });

  // 오디오 producer 생성
  if (localScreen.getAudioTracks().length) {
    screenAudioProducer = await sendTransport.produce({
      track: localScreen.getAudioTracks()[0],
      appData: { mediaTag: "screen-audio" },
    });
  }

  // 화면 공유 중지 이벤트 핸들러 등록 - 이벤트 트리거는 브라우저의 내장 화면 공유 UI에 의해 처리
  screenVideoProducer.track.onended = async () => {
    log("screen share stopped");
    try {
      await screenVideoProducer.pause();
      let { error } = await sig("close-producer", {
        producerId: screenVideoProducer.id,
      });
      await screenVideoProducer.close();
      screenVideoProducer = null;
      if (error) {
        err(error);
      }
      if (screenAudioProducer) {
        let { error } = await sig("close-producer", {
          producerId: screenAudioProducer.id,
        });
        await screenAudioProducer.close();
        screenAudioProducer = null;
        if (error) {
          err(error);
        }
      }
    } catch (e) {
      console.error(e);
    }
    $("#local-screen-pause-ctrl").style.display = "none";
    $("#local-screen-audio-pause-ctrl").style.display = "none";
    $("#share-screen").style.display = "initial";
  };

  $("#local-screen-pause-ctrl").style.display = "block";
  if (screenAudioProducer) {
    $("#local-screen-audio-pause-ctrl").style.display = "block";
  }
}

/**
 * @title 카메라 시작
 * @returns
 */
export async function startCamera() {
  if (localCam) {
    return;
  }
  log("start camera");
  try {
    localCam = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  } catch (e) {
    console.error("start camera error", e);
  }
}

// 카메라가 여러개 있는 경우 - 보유한 디바이스 목록에서 다음 카메라 디바이스 비디오 전송으로 전환
export async function cycleCamera() {
  if (!(camVideoProducer && camVideoProducer.track)) {
    warn("cannot cycle camera - no current camera track");
    return;
  }

  log("cycle camera");

  // 장치 목록에서 다음 장치 찾기
  const deviceId = await getCurrentDeviceId();
  const allDevices = await navigator.mediaDevices.enumerateDevices();
  const vidDevices = allDevices.filter((d) => d.kind === "videoinput");
  if (!vidDevices.length > 1) {
    warn("cannot cycle camera - only one camera");
    return;
  }
  let idx = vidDevices.findIndex((d) => d.deviceId === deviceId);
  if (idx === vidDevices.length - 1) {
    idx = 0;
  } else {
    idx += 1;
  }

  // get a new video stream. might as well get a new audio stream too,
  // just in case browsers want to group audio/video streams together
  // from the same device when possible (though they don't seem to,
  // currently)
  /**
   *
   */
  log("getting a video stream from new device", vidDevices[idx].label);
  localCam = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: vidDevices[idx].deviceId } },
    audio: true,
  });

  // replace the tracks we are sending
  await camVideoProducer.replaceTrack({ track: localCam.getVideoTracks()[0] });
  await camAudioProducer.replaceTrack({ track: localCam.getAudioTracks()[0] });

  // update the user interface
  showCameraInfo();
}

export async function stopStreams() {
  if (!(localCam || localScreen)) {
    return;
  }
  if (!sendTransport) {
    return;
  }

  log("stop sending media streams");
  $("#stop-streams").style.display = "none";

  let { error } = await sig("close-transport", {
    transportId: sendTransport.id,
  });
  if (error) {
    err(error);
  }
  // closing the sendTransport closes all associated producers. when
  // the camVideoProducer and camAudioProducer are closed,
  // mediasoup-client stops the local cam tracks, so we don't need to
  // do anything except set all our local variables to null.
  try {
    await sendTransport.close();
  } catch (e) {
    console.error(e);
  }
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;

  // update relevant ui elements
  $("#send-camera").style.display = "initial";
  $("#share-screen").style.display = "initial";
  $("#local-screen-pause-ctrl").style.display = "none";
  $("#local-screen-audio-pause-ctrl").style.display = "none";
  showCameraInfo();
}

export async function leaveRoom() {
  if (!joined) {
    return;
  }

  log("leave room");
  $("#leave-room").style.display = "none";

  // stop polling
  clearInterval(pollingInterval);

  // close everything on the server-side (transports, producers, consumers)
  let { error } = await sig("leave");
  if (error) {
    err(error);
  }

  // closing the transports closes all producers and consumers. we
  // don't need to do anything beyond closing the transports, except
  // to set all our local variables to their initial states
  try {
    recvTransport && (await recvTransport.close());
    sendTransport && (await sendTransport.close());
  } catch (e) {
    console.error(e);
  }
  recvTransport = null;
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;
  lastPollSyncData = {};
  consumers = [];
  joined = false;

  // hacktastically restore ui to initial state
  $("#join-control").style.display = "initial";
  $("#send-camera").style.display = "initial";
  $("#stop-streams").style.display = "none";
  $("#remote-video").innerHTML = "";
  $("#share-screen").style.display = "initial";
  $("#local-screen-pause-ctrl").style.display = "none";
  $("#local-screen-audio-pause-ctrl").style.display = "none";
  showCameraInfo();
  updateCamVideoProducerStatsDisplay();
  updateScreenVideoProducerStatsDisplay();
  updatePeersDisplay();
}

export async function subscribeToTrack(peerId, mediaTag) {
  log("subscribe to track", peerId, mediaTag);

  // create a receive transport if we don't already have one
  if (!recvTransport) {
    recvTransport = await createTransport("recv");
  }

  // if we do already have a consumer, we shouldn't have called this
  // method
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (consumer) {
    err("already have consumer for track", peerId, mediaTag);
    return;
  }

  // ask the server to create a server-side consumer object and send
  // us back the info we need to create a client-side consumer
  let consumerParameters = await sig("recv-track", {
    mediaTag,
    mediaPeerId: peerId,
    rtpCapabilities: device.rtpCapabilities,
  });
  log("consumer parameters", consumerParameters);
  consumer = await recvTransport.consume({
    ...consumerParameters,
    appData: { peerId, mediaTag },
  });
  log("created new consumer", consumer.id);

  // the server-side consumer will be started in paused state. wait
  // until we're connected, then send a resume request to the server
  // to get our first keyframe and start displaying video
  while (recvTransport.connectionState !== "connected") {
    log("  transport connstate", recvTransport.connectionState);
    await sleep(100);
  }
  // okay, we're ready. let's ask the peer to send us media
  await resumeConsumer(consumer);

  // keep track of all our consumers
  consumers.push(consumer);

  // ui
  await addVideoAudio(consumer);
  updatePeersDisplay();
}

export async function unsubscribeFromTrack(peerId, mediaTag) {
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (!consumer) {
    return;
  }

  log("unsubscribe from track", peerId, mediaTag);
  try {
    await closeConsumer(consumer);
  } catch (e) {
    console.error(e);
  }
  // force update of ui
  updatePeersDisplay();
}

export async function pauseConsumer(consumer) {
  if (consumer) {
    log("pause consumer", consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig("pause-consumer", { consumerId: consumer.id });
      await consumer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function resumeConsumer(consumer) {
  if (consumer) {
    log("resume consumer", consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig("resume-consumer", { consumerId: consumer.id });
      await consumer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function pauseProducer(producer) {
  if (producer) {
    log("pause producer", producer.appData.mediaTag);
    try {
      await sig("pause-producer", { producerId: producer.id });
      await producer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function resumeProducer(producer) {
  if (producer) {
    log("resume producer", producer.appData.mediaTag);
    try {
      await sig("resume-producer", { producerId: producer.id });
      await producer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

async function closeConsumer(consumer) {
  if (!consumer) {
    return;
  }
  log("closing consumer", consumer.appData.peerId, consumer.appData.mediaTag);
  try {
    // tell the server we're closing this consumer. (the server-side
    // consumer may have been closed already, but that's okay.)
    await sig("close-consumer", { consumerId: consumer.id });
    await consumer.close();

    consumers = consumers.filter((c) => c !== consumer);
    removeVideoAudio(consumer);
  } catch (e) {
    console.error(e);
  }
}

// utility function to create a transport and hook up signaling logic
// appropriate to the transport's direction
//
async function createTransport(direction) {
  log(`create ${direction} transport`);

  // ask the server to create a server-side transport object and send
  // us back the info we need to create a client-side transport
  let transport,
    { transportOptions } = await sig("create-transport", { direction });
  log("transport options", transportOptions);

  if (direction === "recv") {
    transport = await device.createRecvTransport(transportOptions);
  } else if (direction === "send") {
    transport = await device.createSendTransport(transportOptions);
  } else {
    throw new Error(`bad transport 'direction': ${direction}`);
  }

  // mediasoup-client will emit a connect event when media needs to
  // start flowing for the first time. send dtlsParameters to the
  // server, then call callback() on success or errback() on failure.
  transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    log("transport connect event", direction);
    let { error } = await sig("connect-transport", {
      transportId: transportOptions.id,
      dtlsParameters,
    });
    if (error) {
      err("error connecting transport", direction, error);
      errback();
      return;
    }
    callback();
  });

  if (direction === "send") {
    // sending transports will emit a produce event when a new track
    // needs to be set up to start sending. the producer's appData is
    // passed as a parameter
    transport.on(
      "produce",
      async ({ kind, rtpParameters, appData }, callback, errback) => {
        log("transport produce event", appData.mediaTag);
        // we may want to start out paused (if the checkboxes in the ui
        // aren't checked, for each media type. not very clean code, here
        // but, you know, this isn't a real application.)
        let paused = false;
        if (appData.mediaTag === "cam-video") {
          paused = getCamPausedState();
        } else if (appData.mediaTag === "cam-audio") {
          paused = getMicPausedState();
        }
        // tell the server what it needs to know from us in order to set
        // up a server-side producer object, and get back a
        // producer.id. call callback() on success or errback() on
        // failure.
        let { error, id } = await sig("send-track", {
          transportId: transportOptions.id,
          kind,
          rtpParameters,
          paused,
          appData,
        });
        if (error) {
          err("error setting up server-side producer", error);
          errback();
          return;
        }
        callback({ id });
      }
    );
  }

  // for this simple demo, any time a transport transitions to closed,
  // failed, or disconnected, leave the room and reset
  //
  transport.on("connectionstatechange", async (state) => {
    log(`transport ${transport.id} connectionstatechange ${state}`);
    // for this simple sample code, assume that transports being
    // closed is an error (we never close these transports except when
    // we leave the room)
    if (state === "closed" || state === "failed" || state === "disconnected") {
      log("transport closed ... leaving the room and resetting");
      leaveRoom();
    }
  });

  return transport;
}

/**
 * @title 폴링, 업데이트 로직
 * @description 활성화된 스피커 갱신, 프로듀서 (비디오, 화면) 통계 표시 갱신, 컨슈머 통계 표시 갱신
 * @returns
 */
async function pollAndUpdate() {
  let { peers, activeSpeaker, error } = await sig("sync");
  if (error) {
    return { error };
  }

  currentActiveSpeaker = activeSpeaker;
  updateActiveSpeaker();
  updateCamVideoProducerStatsDisplay();
  updateScreenVideoProducerStatsDisplay();
  updateConsumersStatsDisplay();

  // 트랙 목록, 비디오/오디오 업데이트 여부 체크
  const thisPeersList = sortPeers(peers);
  const lastPeersList = sortPeers(lastPollSyncData);
  // 현재 피어 목록과 마지막 피어 목록이 다르다면
  if (!deepEqual(thisPeersList, lastPeersList)) {
    // 피어 목록 갱신
    updatePeersDisplay(peers, thisPeersList);
  }

  for (let id in lastPollSyncData) {
    // 마지막 동기화된 피어 정보에서 새롭게 받은 피어 정보에서 해당 피어가 없다면
    if (!peers[id]) {
      log(`peer ${id} has exited`);
      // 해당 피어를 갖는 모든 컨슈머를 닫는다.
      consumers.forEach((consumer) => {
        if (consumer.appData.peerId === id) {
          closeConsumer(consumer);
        }
      });
    }
  }

  consumers.forEach((consumer) => {
    const { peerId, mediaTag } = consumer.appData;
    // 피어가 우리가 소비하는 미디어 전송을 중단한 경우
    if (!peers[peerId].media[mediaTag]) {
      log(`peer ${peerId} has stopped transmitting ${mediaTag}`);
      // 컨슈머를 닫는다.(비디오, 오디오 요소 제거)
      closeConsumer(consumer);
    }
  });

  // 피어 정보 동기화
  lastPollSyncData = peers;

  // 오류가 없으면 빈 객체를 반환
  return {};
}

function sortPeers(peers) {
  return Object.entries(peers)
    .map(([id, info]) => ({
      id,
      joinTs: info.joinTs,
      media: { ...info.media },
    }))
    .sort((a, b) => (a.joinTs > b.joinTs ? 1 : b.joinTs > a.joinTs ? -1 : 0));
}

function findConsumerForTrack(peerId, mediaTag) {
  return consumers.find(
    (c) => c.appData.peerId === peerId && c.appData.mediaTag === mediaTag
  );
}

//
// -- user interface --
//

/**
 * @title 카메라 멈춤 여부
 * @returns
 */
export function getCamPausedState() {
  return !$("#local-cam-checkbox").checked;
}

export function getMicPausedState() {
  return !$("#local-mic-checkbox").checked;
}

export function getScreenPausedState() {
  return !$("#local-screen-checkbox").checked;
}

export function getScreenAudioPausedState() {
  return !$("#local-screen-audio-checkbox").checked;
}

export async function changeCamPaused() {
  if (getCamPausedState()) {
    pauseProducer(camVideoProducer);
    $("#local-cam-label").innerHTML = "camera (paused)";
  } else {
    resumeProducer(camVideoProducer);
    $("#local-cam-label").innerHTML = "camera";
  }
}

export async function changeMicPaused() {
  if (getMicPausedState()) {
    pauseProducer(camAudioProducer);
    $("#local-mic-label").innerHTML = "mic (paused)";
  } else {
    resumeProducer(camAudioProducer);
    $("#local-mic-label").innerHTML = "mic";
  }
}

export async function changeScreenPaused() {
  if (getScreenPausedState()) {
    pauseProducer(screenVideoProducer);
    $("#local-screen-label").innerHTML = "screen (paused)";
  } else {
    resumeProducer(screenVideoProducer);
    $("#local-screen-label").innerHTML = "screen";
  }
}

export async function changeScreenAudioPaused() {
  if (getScreenAudioPausedState()) {
    pauseProducer(screenAudioProducer);
    $("#local-screen-audio-label").innerHTML = "screen (paused)";
  } else {
    resumeProducer(screenAudioProducer);
    $("#local-screen-audio-label").innerHTML = "screen";
  }
}

export async function updatePeersDisplay(
  peersInfo = lastPollSyncData,
  sortedPeers = sortPeers(peersInfo)
) {
  log("room state updated", peersInfo);

  $("#available-tracks").innerHTML = "";
  if (camVideoProducer) {
    $("#available-tracks").appendChild(
      makeTrackControlEl(
        "my",
        "cam-video",
        peersInfo[myPeerId].media["cam-video"]
      )
    );
  }
  if (camAudioProducer) {
    $("#available-tracks").appendChild(
      makeTrackControlEl(
        "my",
        "cam-audio",
        peersInfo[myPeerId].media["cam-audio"]
      )
    );
  }
  if (screenVideoProducer) {
    $("#available-tracks").appendChild(
      makeTrackControlEl(
        "my",
        "screen-video",
        peersInfo[myPeerId].media["screen-video"]
      )
    );
  }
  if (screenAudioProducer) {
    $("#available-tracks").appendChild(
      makeTrackControlEl(
        "my",
        "screen-audio",
        peersInfo[myPeerId].media["screen-audio"]
      )
    );
  }

  for (let peer of sortedPeers) {
    if (peer.id === myPeerId) {
      continue;
    }
    for (let [mediaTag, info] of Object.entries(peer.media)) {
      $("#available-tracks").appendChild(
        makeTrackControlEl(peer.id, mediaTag, info)
      );
    }
  }
}

function makeTrackControlEl(peerName, mediaTag, mediaInfo) {
  let div = document.createElement("div"),
    peerId = peerName === "my" ? myPeerId : peerName,
    consumer = findConsumerForTrack(peerId, mediaTag);
  div.classList = `track-subscribe track-subscribe-${peerId}`;

  let sub = document.createElement("button");
  if (!consumer) {
    sub.innerHTML += "subscribe";
    sub.onclick = () => subscribeToTrack(peerId, mediaTag);
    div.appendChild(sub);
  } else {
    sub.innerHTML += "unsubscribe";
    sub.onclick = () => unsubscribeFromTrack(peerId, mediaTag);
    div.appendChild(sub);
  }

  let trackDescription = document.createElement("span");
  trackDescription.innerHTML = `${peerName} ${mediaTag}`;
  div.appendChild(trackDescription);

  try {
    if (mediaInfo) {
      let producerPaused = mediaInfo.paused;
      let prodPauseInfo = document.createElement("span");
      prodPauseInfo.innerHTML = producerPaused
        ? "[producer paused]"
        : "[producer playing]";
      div.appendChild(prodPauseInfo);
    }
  } catch (e) {
    console.error(e);
  }

  if (consumer) {
    let pause = document.createElement("span"),
      checkbox = document.createElement("input"),
      label = document.createElement("label");
    pause.classList = "nowrap";
    checkbox.type = "checkbox";
    checkbox.checked = !consumer.paused;
    checkbox.onchange = async () => {
      if (checkbox.checked) {
        await resumeConsumer(consumer);
      } else {
        await pauseConsumer(consumer);
      }
      updatePeersDisplay();
    };
    label.id = `consumer-stats-${consumer.id}`;
    if (consumer.paused) {
      label.innerHTML = "[consumer paused]";
    } else {
      let stats = lastPollSyncData[myPeerId].stats[consumer.id],
        bitrate = "-";
      if (stats) {
        bitrate = Math.floor(stats.bitrate / 1000.0);
      }
      label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
    }
    pause.appendChild(checkbox);
    pause.appendChild(label);
    div.appendChild(pause);

    if (consumer.kind === "video") {
      let remoteProducerInfo = document.createElement("span");
      remoteProducerInfo.classList = "nowrap track-ctrl";
      remoteProducerInfo.id = `track-ctrl-${consumer.producerId}`;
      div.appendChild(remoteProducerInfo);
    }
  }

  return div;
}

function addVideoAudio(consumer) {
  if (!(consumer && consumer.track)) {
    return;
  }
  let el = document.createElement(consumer.kind);
  // set some attributes on our audio and video elements to make
  // mobile Safari happy. note that for audio to play you need to be
  // capturing from the mic/camera
  if (consumer.kind === "video") {
    el.setAttribute("playsinline", true);
  } else {
    el.setAttribute("playsinline", true);
    el.setAttribute("autoplay", true);
  }
  $(`#remote-${consumer.kind}`).appendChild(el);
  el.srcObject = new MediaStream([consumer.track.clone()]);
  el.consumer = consumer;
  // let's "yield" and return before playing, rather than awaiting on
  // play() succeeding. play() will not succeed on a producer-paused
  // track until the producer unpauses.
  el.play()
    .then(() => {})
    .catch((e) => {
      err(e);
    });
}

function removeVideoAudio(consumer) {
  document.querySelectorAll(consumer.kind).forEach((v) => {
    if (v.consumer === consumer) {
      v.parentNode.removeChild(v);
    }
  });
}

async function showCameraInfo() {
  let deviceId = await getCurrentDeviceId(),
    infoEl = $("#camera-info");
  if (!deviceId) {
    infoEl.innerHTML = "";
    return;
  }
  let devices = await navigator.mediaDevices.enumerateDevices(),
    deviceInfo = devices.find((d) => d.deviceId === deviceId);
  infoEl.innerHTML = `
      ${deviceInfo.label}
      <button onclick="Client.cycleCamera()">switch camera</button>
  `;
}

export async function getCurrentDeviceId() {
  if (!camVideoProducer) {
    return null;
  }
  let deviceId = camVideoProducer.track.getSettings().deviceId;
  if (deviceId) {
    return deviceId;
  }
  // Firefox doesn't have deviceId in MediaTrackSettings object
  let track = localCam && localCam.getVideoTracks()[0];
  if (!track) {
    return null;
  }
  let devices = await navigator.mediaDevices.enumerateDevices(),
    deviceInfo = devices.find((d) => d.label.startsWith(track.label));
  return deviceInfo.deviceId;
}

/**
 * 활성화된 스피커 갱신
 */
function updateActiveSpeaker() {
  $$(".track-subscribe").forEach((el) => {
    el.classList.remove("active-speaker");
  });
  if (currentActiveSpeaker.peerId) {
    $$(`.track-subscribe-${currentActiveSpeaker.peerId}`).forEach((el) => {
      el.classList.add("active-speaker");
    });
  }
}

function updateCamVideoProducerStatsDisplay() {
  let tracksEl = $("#camera-producer-stats");
  tracksEl.innerHTML = "";
  if (!camVideoProducer || camVideoProducer.paused) {
    return;
  }
  makeProducerTrackSelector({
    internalTag: "local-cam-tracks",
    container: tracksEl,
    peerId: myPeerId,
    producerId: camVideoProducer.id,
    currentLayer: camVideoProducer.maxSpatialLayer,
    layerSwitchFunc: (i) => {
      console.log("client set layers for cam stream");
      camVideoProducer.setMaxSpatialLayer(i);
    },
  });
}

function updateScreenVideoProducerStatsDisplay() {
  let tracksEl = $("#screen-producer-stats");
  tracksEl.innerHTML = "";
  if (!screenVideoProducer || screenVideoProducer.paused) {
    return;
  }
  makeProducerTrackSelector({
    internalTag: "local-screen-tracks",
    container: tracksEl,
    peerId: myPeerId,
    producerId: screenVideoProducer.id,
    currentLayer: screenVideoProducer.maxSpatialLayer,
    layerSwitchFunc: (i) => {
      console.log("client set layers for screen stream");
      screenVideoProducer.setMaxSpatialLayer(i);
    },
  });
}

function updateConsumersStatsDisplay() {
  try {
    for (let consumer of consumers) {
      let label = $(`#consumer-stats-${consumer.id}`);
      if (label) {
        if (consumer.paused) {
          label.innerHTML = "(consumer paused)";
        } else {
          let stats = lastPollSyncData[myPeerId].stats[consumer.id],
            bitrate = "-";
          if (stats) {
            bitrate = Math.floor(stats.bitrate / 1000.0);
          }
          label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
        }
      }

      let mediaInfo =
        lastPollSyncData[consumer.appData.peerId] &&
        lastPollSyncData[consumer.appData.peerId].media[
          consumer.appData.mediaTag
        ];
      if (mediaInfo && !mediaInfo.paused) {
        let tracksEl = $(`#track-ctrl-${consumer.producerId}`);
        if (
          tracksEl &&
          lastPollSyncData[myPeerId].consumerLayers[consumer.id]
        ) {
          tracksEl.innerHTML = "";
          let currentLayer =
            lastPollSyncData[myPeerId].consumerLayers[consumer.id].currentLayer;
          makeProducerTrackSelector({
            internalTag: consumer.id,
            container: tracksEl,
            peerId: consumer.appData.peerId,
            producerId: consumer.producerId,
            currentLayer: currentLayer,
            layerSwitchFunc: (i) => {
              console.log("ask server to set layers");
              sig("consumer-set-layers", {
                consumerId: consumer.id,
                spatialLayer: i,
              });
            },
          });
        }
      }
    }
  } catch (e) {
    log("error while updating consumers stats display", e);
  }
}

function makeProducerTrackSelector({
  internalTag,
  container,
  peerId,
  producerId,
  currentLayer,
  layerSwitchFunc,
}) {
  try {
    let pollStats =
      lastPollSyncData[peerId] && lastPollSyncData[peerId].stats[producerId];
    if (!pollStats) {
      return;
    }

    let stats = [...Array.from(pollStats)].sort((a, b) =>
      a.rid > b.rid ? 1 : a.rid < b.rid ? -1 : 0
    );
    let i = 0;
    for (let s of stats) {
      let div = document.createElement("div"),
        radio = document.createElement("input"),
        label = document.createElement("label"),
        x = i;
      radio.type = "radio";
      radio.name = `radio-${internalTag}-${producerId}`;
      radio.checked =
        currentLayer == undefined ? i === stats.length - 1 : i === currentLayer;
      radio.onchange = () => layerSwitchFunc(x);
      let bitrate = Math.floor(s.bitrate / 1000);
      label.innerHTML = `${bitrate} kb/s`;
      div.appendChild(radio);
      div.appendChild(label);
      container.appendChild(div);
      i++;
    }
    if (i) {
      let txt = document.createElement("div");
      txt.innerHTML = "tracks";
      container.insertBefore(txt, container.firstChild);
    }
  } catch (e) {
    log("error while updating track stats display", e);
  }
}

//
// encodings for outgoing video
//

/**
 * 인코딩 해상도
 */
const CAM_VIDEO_SIMULCAST_ENCODINGS = [
  { maxBitrate: 96000, scaleResolutionDownBy: 4 },
  { maxBitrate: 680000, scaleResolutionDownBy: 1 },
];

function camEncodings() {
  return CAM_VIDEO_SIMULCAST_ENCODINGS;
}

//
/**
 * @title 스트림 대역폭 제한
 */
function screenshareEncodings() {
  null;
}

/**
 * @title http 요청
 * @description http 요청을 위해 사용
 * @param {string} endpoint 엔드포인트
 * @param {Object} data 데이터
 * @param {Boolean} beacon 비콘 사용여부
 * @returns
 */
async function sig(endpoint, data, beacon) {
  try {
    let headers = { "Content-Type": "application/json" },
      body = JSON.stringify({ ...data, peerId: myPeerId });

    if (beacon) {
      // @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
      // navigator.sendBeacon 를 지원하지 않는 브라우저에서는 visibilitychange 를 대체제로 사용함
      navigator.sendBeacon("/signaling/" + endpoint, body);
      return null;
    }

    let response = await fetch("/signaling/" + endpoint, {
      method: "POST",
      body,
      headers,
    });
    return await response.json();
  } catch (e) {
    console.error(e);
    return { error: e };
  }
}

/**
 * @title uuid 생성
 * @returns
 */
function uuidv4() {
  return "111-111-1111".replace(/[018]/g, () =>
    (crypto.getRandomValues(new Uint8Array(1))[0] & 15).toString(16)
  );
}

/**
 * @title Sleep
 * @description promise sleep
 * @param {Number} ms delay(ms)
 * @returns
 */
async function sleep(delay) {
  return new Promise((resolve) => setTimeout(() => resolve(), delay));
}
