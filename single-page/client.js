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
/** 받기 transport */
export let recvTransport;
/** 보내기 transport */
export let sendTransport;
/** 카메라 프로듀서 - sendTransport.produce 를 통해 생성 */
export let camVideoProducer;
/** 오디오 프로듀서 - sendTransport.produce 를 통해 생성 */
export let camAudioProducer;
// screen video producer
export let screenVideoProducer;
// screen audio producer
export let screenAudioProducer;
/** 현재 활성화된 스피커 */
export let currentActiveSpeaker = {};
/** 마지막 폴링으로 동기화된 피어 데이터 */
export let lastPollSyncData = {};
/** 컨슈머 목록 */
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
    // http 요청 - unload 이벤트에 연결 끊김 여부를 서버에 알려준다.
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
    // http 요청 - 새로운 피어임을 알린다.
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
    // 폴링, 업데이트 로직
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
  // 방 입장
  await joinRoom();
  // 카메라 시작
  await startCamera();

  // sendTransport가 없다면 sendTransport 생성
  if (!sendTransport) {
    // transport 생성
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
  // 현재 카메라 정보 노출
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
    // transport 생성
    sendTransport = await createTransport("send");
  }

  // 공유용 로컬 스크린
  localScreen = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  // screen video producer 생성
  screenVideoProducer = await sendTransport.produce({
    track: localScreen.getVideoTracks()[0],
    encodings: screenshareEncodings(),
    appData: { mediaTag: "screen-video" },
  });

  // screen audio producer 생성
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
      // http 요청
      let { error } = await sig("close-producer", {
        producerId: screenVideoProducer.id,
      });
      await screenVideoProducer.close();
      screenVideoProducer = null;
      if (error) {
        err(error);
      }
      if (screenAudioProducer) {
        // http 요청
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

/**
 * @title 카메라 전환
 * @description 보유한 디바이스 목록에서 다음 카메라 디바이스 비디오 전송으로 전환
 * @returns
 */
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

  /**
   * 새 비디오 스트림을 가져온다.
   * 새로운 오디오 스트림도 얻을 수 있다.
   * 브라우저가 동일한 장치에서 오디오/비디오 스트림을 함께 그룹화하기를 원하는 경우에 대한 처리(현재 그렇지 않음).
   */
  log("getting a video stream from new device", vidDevices[idx].label);
  localCam = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: vidDevices[idx].deviceId } },
    audio: true,
  });

  // 우리가 보내는 tack을 교체한다
  await camVideoProducer.replaceTrack({ track: localCam.getVideoTracks()[0] });
  await camAudioProducer.replaceTrack({ track: localCam.getAudioTracks()[0] });

  // 현재 카메라 정보 노출
  showCameraInfo();
}

/**
 * @title 스트림 종료
 * @returns
 */
export async function stopStreams() {
  if (!(localCam || localScreen)) {
    return;
  }
  if (!sendTransport) {
    return;
  }

  log("stop sending media streams");
  $("#stop-streams").style.display = "none";

  // http 요청
  let { error } = await sig("close-transport", {
    transportId: sendTransport.id,
  });
  if (error) {
    err(error);
  }

  try {
    /**
     * sendTransport를 닫으면 모든 관련 producer(camVideoProducer 및 camAudioProducer)가 닫힌다.
     * mediasup-client는 local cam track을 중지하므로 모든 local 변수를 null로 설정하는 것 외에는 아무것도 할 필요가 없다.
     */
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

  // 관련 UI 갱신
  $("#send-camera").style.display = "initial";
  $("#share-screen").style.display = "initial";
  $("#local-screen-pause-ctrl").style.display = "none";
  $("#local-screen-audio-pause-ctrl").style.display = "none";
  // 현재 카메라 정보 노출
  showCameraInfo();
}

/**
 * @title 방에서 나가기
 * @returns
 */
export async function leaveRoom() {
  if (!joined) {
    return;
  }

  log("leave room");
  $("#leave-room").style.display = "none";

  // 인터벌 pollAndUpdate 호출 처리 중지
  clearInterval(pollingInterval);

  // http 요청 - 서버 측(transport, producers, consumers)의 모든 것을 닫는다.
  let { error } = await sig("leave");
  if (error) {
    err(error);
  }

  /**
   * transports를 닫는것은 것은 모든 producer 와 consumers를 다는것이이다.
   * transports 를 닫는것 외에 추가 작업은 필요없다.
   * 따라서 모든 지역 변수를 초기 상태로 설정한다.
   */
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

  // UI 최초 상태로 되돌린다.
  $("#join-control").style.display = "initial";
  $("#send-camera").style.display = "initial";
  $("#stop-streams").style.display = "none";
  $("#remote-video").innerHTML = "";
  $("#share-screen").style.display = "initial";
  $("#local-screen-pause-ctrl").style.display = "none";
  $("#local-screen-audio-pause-ctrl").style.display = "none";
  // 현재 카메라 정보 노출
  showCameraInfo();
  // CamVideo Producer Stats 디스플레이 업데이트
  updateCamVideoProducerStatsDisplay();
  // ScreenVideo Producer Stats 디스플레이 업데이트
  updateScreenVideoProducerStatsDisplay();
  // peer 정보 노출 갱신
  updatePeersDisplay();
}

/**
 * @title track 구독
 * @param {string} peerId
 * @param {*} mediaTag
 * @returns
 */
export async function subscribeToTrack(peerId, mediaTag) {
  log("subscribe to track", peerId, mediaTag);

  // receive transport 를 갖고 있지 않다면 receive transport를 생성한다.
  if (!recvTransport) {
    recvTransport = await createTransport("recv");
  }

  // track을 위한 컨슈머 검색
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (consumer) {
    // consumer 존재한다면, 호출되지 않아야 하므로 리턴처리
    err("already have consumer for track", peerId, mediaTag);
    return;
  }

  /**
   * http 요청 - 서버에 서버 측 consumer 객체를 만들고 전송하도록 요청하고
   * 클라이언트 측 consumer를 만드는 데 필요한 정보를 백업한다.
   */
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

  /**
   * 서버 측 consumer는 일시 중지된 상태에서 시작된다.
   * 연결될 때까지 기다린 다음 첫 번째 키프레임을 가져오고 비디오 표시를 시작하기 위해 서버 resume 요청을 보낸다.
   */
  while (recvTransport.connectionState !== "connected") {
    log("  transport connstate", recvTransport.connectionState);
    await sleep(100);
  }
  // 클라이언트 준비 완료, peer에 미디어를 보내달라고 요청한다.
  await resumeConsumer(consumer);

  // consumer 목록 추가
  consumers.push(consumer);

  // 비디오 또는 오디오를 추가한다.
  await addVideoAudio(consumer);
  // 피어 목록 갱신
  updatePeersDisplay();
}

/**
 * @title track 구독 취소
 * @param {string} peerId
 * @param {string} mediaTag
 * @returns
 */
export async function unsubscribeFromTrack(peerId, mediaTag) {
  // track을 위한 컨슈머 검색
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
  // peer 정보 노출 갱신
  updatePeersDisplay();
}

/**
 * @title consumer 멈춤
 * @param {*} consumer
 */
export async function pauseConsumer(consumer) {
  if (consumer) {
    log("pause consumer", consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      // http 요청
      await sig("pause-consumer", { consumerId: consumer.id });
      await consumer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * @title consumer 재시작
 * @description peer에 미디어를 보내달라고 요청한다.
 * @param {*} consumer
 */
export async function resumeConsumer(consumer) {
  if (consumer) {
    log("resume consumer", consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      // http 요청
      await sig("resume-consumer", { consumerId: consumer.id });
      await consumer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * @title Producer 멈춤
 * @param {*} producer
 */
export async function pauseProducer(producer) {
  if (producer) {
    log("pause producer", producer.appData.mediaTag);
    try {
      // http 요청
      await sig("pause-producer", { producerId: producer.id });
      await producer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * @title Producer 재시작
 * @param {*} producer
 */
export async function resumeProducer(producer) {
  if (producer) {
    log("resume producer", producer.appData.mediaTag);
    try {
      // http 요청
      await sig("resume-producer", { producerId: producer.id });
      await producer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

/**
 * @title 컨슈머 닫기
 * @param {*} consumer
 * @returns
 */
async function closeConsumer(consumer) {
  if (!consumer) {
    return;
  }
  log("closing consumer", consumer.appData.peerId, consumer.appData.mediaTag);
  try {
    /**
     * 해당 consumer 를 닫는것을 서버에 알린다
     * 서버 측 consumer는 이미 닫혔을 수 있지만 괜찮다.
     */
    await sig("close-consumer", { consumerId: consumer.id });
    await consumer.close();

    consumers = consumers.filter((c) => c !== consumer);
    // 비디오 또는 오디오 제거
    removeVideoAudio(consumer);
  } catch (e) {
    console.error(e);
  }
}

/**
 * @title transport 생성
 * @description transport를 생성하고, 전송 방향에 맞는 signal 로직을 연결한다.
 * @param {*} direction
 * @returns
 */
async function createTransport(direction) {
  log(`create ${direction} transport`);

  /**
   * 서버에 서버 측 transport 객체를 생성하도록 요청하고
   * 클라이언트 측 transport를 생성하는 데 필요한 정보를 다시 보내야한다.
   */
  let transport,
    // http 요청
    { transportOptions } = await sig("create-transport", { direction });
  log("transport options", transportOptions);

  if (direction === "recv") {
    transport = await device.createRecvTransport(transportOptions);
  } else if (direction === "send") {
    transport = await device.createSendTransport(transportOptions);
  } else {
    throw new Error(`bad transport 'direction': ${direction}`);
  }

  /**
   * mediasoup-client는 미디어가 처음으로 흐르기 시작해야 연결 이벤트를 보낸다.
   * dtlsParameters를 서버로 보낸 다음 성공하면 callback()을 호출하고 실패하면 errback()을 호출한다.
   */
  transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    log("transport connect event", direction);
    // http 요청
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
    /**
     * transport 전송은 전송을 시작하기 위해 새 track을 설정해야 할 때 생성 이벤트를 내보낸다.
     * producer의 appData는 매개변수로 전달
     */
    transport.on(
      "produce",
      async ({ kind, rtpParameters, appData }, callback, errback) => {
        log("transport produce event", appData.mediaTag);
        /**
         * UI의 체크박스가 선택되지 않은 경우 각 미디어 종류에 대해 일시 중지된 상태로 시작하고 싶을 수 있다.
         */
        let paused = false;
        if (appData.mediaTag === "cam-video") {
          paused = getCamPausedState();
        } else if (appData.mediaTag === "cam-audio") {
          paused = getMicPausedState();
        }
        /**
         * 서버 측 producer 객체를 설정하기 위해 서버에게 우리의 정보를 전달하고 생산자 ID를 반환 받는다.
         * 성공 시 callback() 또는 호출 실패 시 errback()  호출
         */
        // http 요청
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
  /**
   * 현재 데모는 간단하게 구현되어 있기 때문에
   * transport가 닫힘/실패/연결 끊김으로 전환될 때마다 방에서 나와 재설정 해야 한다.
   */
  transport.on("connectionstatechange", async (state) => {
    log(`transport ${transport.id} connectionstatechange ${state}`);
    /**
     * 현재 샘플 코드에서는 closed 전송이 오류라고 가정한다.
     * 방을 나갈 때를 제외하고는 전송을 닫지 않는다.
     */
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
  // http 요청
  let { peers, activeSpeaker, error } = await sig("sync");
  if (error) {
    return { error };
  }

  currentActiveSpeaker = activeSpeaker;
  // 활성화된 스피커 갱신
  updateActiveSpeaker();
  // CamVideo Producer Stats 디스플레이 업데이트
  updateCamVideoProducerStatsDisplay();
  // ScreenVideo Producer Stats 디스플레이 업데이트
  updateScreenVideoProducerStatsDisplay();
  // consumer state 디스플레이 업데이트
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

/**
 * @title peer 목록 정렬
 * @param {*} peers
 * @returns
 */
function sortPeers(peers) {
  return Object.entries(peers)
    .map(([id, info]) => ({
      id,
      joinTs: info.joinTs,
      media: { ...info.media },
    }))
    .sort((a, b) => (a.joinTs > b.joinTs ? 1 : b.joinTs > a.joinTs ? -1 : 0));
}

/**
 * @title track을 위한 컨슈머 검색
 * @param {string} peerId
 * @param {string} mediaTag
 * @returns
 */
function findConsumerForTrack(peerId, mediaTag) {
  return consumers.find(
    (c) => c.appData.peerId === peerId && c.appData.mediaTag === mediaTag
  );
}

//
// -- user interface --
//

/**
 * @title 카메라 멈춤 상태 가져오기
 * @returns
 */
export function getCamPausedState() {
  return !$("#local-cam-checkbox").checked;
}

/**
 * @title 마이크가 멈춤 상태 가져오기
 * @returns
 */
export function getMicPausedState() {
  return !$("#local-mic-checkbox").checked;
}

/**
 * @title 화면 멈춤 상태 가져오기
 * @returns
 */
export function getScreenPausedState() {
  return !$("#local-screen-checkbox").checked;
}

/**
 * @title ScreenAudio 멈춤 상태 가져오기
 * @returns
 */
export function getScreenAudioPausedState() {
  return !$("#local-screen-audio-checkbox").checked;
}

/**
 * @title Cam 멈춤 토글
 */
export async function changeCamPaused() {
  // 카메라 멈춤 상태라면
  if (getCamPausedState()) {
    // Producer 멈춤
    pauseProducer(camVideoProducer);
    $("#local-cam-label").innerHTML = "camera (paused)";
  } else {
    // Producer 재시작
    resumeProducer(camVideoProducer);
    $("#local-cam-label").innerHTML = "camera";
  }
}

/**
 * @title 마이크 멈춤 토글
 */
export async function changeMicPaused() {
  // 마이크가 멈춤 상태라면
  if (getMicPausedState()) {
    // Producer 멈춤
    pauseProducer(camAudioProducer);
    $("#local-mic-label").innerHTML = "mic (paused)";
  } else {
    // Producer 재시작
    resumeProducer(camAudioProducer);
    $("#local-mic-label").innerHTML = "mic";
  }
}

/**
 * @title 화면 멈춤 토글
 */
export async function changeScreenPaused() {
  // 화면 멈춤 상태라면
  if (getScreenPausedState()) {
    // Producer 멈춤
    pauseProducer(screenVideoProducer);
    $("#local-screen-label").innerHTML = "screen (paused)";
  } else {
    // Producer 재시작
    resumeProducer(screenVideoProducer);
    $("#local-screen-label").innerHTML = "screen";
  }
}

/**
 * @title 화면 오디오 멈춤 토글
 */
export async function changeScreenAudioPaused() {
  // ScreenAudio 멈춤 상태라면
  if (getScreenAudioPausedState()) {
    // Producer 멈춤
    pauseProducer(screenAudioProducer);
    $("#local-screen-audio-label").innerHTML = "screen (paused)";
  } else {
    // Producer 재시작
    resumeProducer(screenAudioProducer);
    $("#local-screen-audio-label").innerHTML = "screen";
  }
}

/**
 * @title peer 정보 노출 갱신
 * @param {*} peersInfo
 * @param {*} sortedPeers
 */
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

/**
 * @title track 제어 엘리먼트 생성
 * @param {string} peerName
 * @param {string} mediaTag
 * @param {*} mediaInfo
 * @returns
 */
function makeTrackControlEl(peerName, mediaTag, mediaInfo) {
  let div = document.createElement("div"),
    peerId = peerName === "my" ? myPeerId : peerName,
    // track을 위한 컨슈머 검색
    consumer = findConsumerForTrack(peerId, mediaTag);
  div.classList = `track-subscribe track-subscribe-${peerId}`;

  let sub = document.createElement("button");
  if (!consumer) {
    sub.innerHTML += "subscribe";
    // track 구독
    sub.onclick = () => subscribeToTrack(peerId, mediaTag);
    div.appendChild(sub);
  } else {
    sub.innerHTML += "unsubscribe";
    // track 구독 취소
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
        // consumer 재시작
        await resumeConsumer(consumer);
      } else {
        // consumer 멈춤
        await pauseConsumer(consumer);
      }
      // peer 정보 노출 갱신
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

/**
 * @title 비디오 또는 오디오 추가
 * @param {*} consumer
 * @returns
 */
function addVideoAudio(consumer) {
  if (!(consumer && consumer.track)) {
    return;
  }
  let el = document.createElement(consumer.kind);
  /**
   * 오디오와 비디오 엘리먼트를 만들기 위해서 일부 어트리뷰트를 설정한다.
   * 오디오를 재생하려면 mic/camera에서 캡처해야 한다.
   */
  if (consumer.kind === "video") {
    el.setAttribute("playsinline", true);
  } else {
    el.setAttribute("playsinline", true);
    el.setAttribute("autoplay", true);
  }
  $(`#remote-${consumer.kind}`).appendChild(el);
  el.srcObject = new MediaStream([consumer.track.clone()]);
  el.consumer = consumer;
  /**
   * play의 성공을 기다리기보다 play 하기 전에 yield 하고 리턴한다.
   * play()는 producer 일시 중지를 해제할 때까지
   * producer 일시 중지 트랙에서 성공하지 못한다.
   */
  el.play()
    .then(() => {})
    .catch((e) => {
      err(e);
    });
}

/**
 * @title 비디오 또는 오디오 제거
 * @param {*} consumer
 */
function removeVideoAudio(consumer) {
  document.querySelectorAll(consumer.kind).forEach((v) => {
    if (v.consumer === consumer) {
      v.parentNode.removeChild(v);
    }
  });
}

/**
 * @title 현재 카메라 정보 노출
 * @returns
 */
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

/**
 * @title 혀재 디바이스 id 반환
 * @returns
 */
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

/**
 * @title CamVideo Producer Stats 디스플레이 업데이트
 * @returns
 */
function updateCamVideoProducerStatsDisplay() {
  let tracksEl = $("#camera-producer-stats");
  tracksEl.innerHTML = "";
  if (!camVideoProducer || camVideoProducer.paused) {
    return;
  }
  // Producer track 셀렉터 생성
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

/**
 * @title  ScreenVideo Producer Stats 디스플레이 업데이트
 * @returns
 */
function updateScreenVideoProducerStatsDisplay() {
  let tracksEl = $("#screen-producer-stats");
  tracksEl.innerHTML = "";
  if (!screenVideoProducer || screenVideoProducer.paused) {
    return;
  }
  // Producer track 셀렉터 생성
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

/**
 * @title consumer state 디스플레이 업데이트
 */
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

          // Producer track 셀렉터 생성
          makeProducerTrackSelector({
            internalTag: consumer.id,
            container: tracksEl,
            peerId: consumer.appData.peerId,
            producerId: consumer.producerId,
            currentLayer: currentLayer,
            layerSwitchFunc: (i) => {
              console.log("ask server to set layers");
              // http 요청
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

/**
 * @title Producer track 셀렉터 생성
 * @param {*} param0
 * @returns
 */
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
