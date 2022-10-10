import domready from "domready";
import UrlParse from "url-parse";
import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";
import {
  applyMiddleware as applyReduxMiddleware,
  createStore as createReduxStore,
} from "redux";
import thunk from "redux-thunk";
// import { createLogger as createReduxLogger } from 'redux-logger';
import randomString from "random-string";
import * as faceapi from "face-api.js";
import Logger from "./Logger";
import log from "./test.logger";
import * as utils from "./utils";
import randomName from "./randomName";
import deviceInfo from "./deviceInfo";
import RoomClient from "./RoomClient";
import RoomContext from "./RoomContext";
import * as cookiesManager from "./cookiesManager";
import * as stateActions from "./redux/stateActions";
import reducers from "./redux/reducers";
import Room from "./components/Room";

const logger = new Logger();
const reduxMiddlewares = [thunk];

// if (process.env.NODE_ENV === 'development')
// {
// 	const reduxLogger = createReduxLogger(
// 		{
// 			duration  : true,
// 			timestamp : false,
// 			level     : 'log',
// 			logErrors : true
// 		});

// 	reduxMiddlewares.push(reduxLogger);
// }

let roomClient;
const store = createReduxStore(
  reducers,
  undefined,
  applyReduxMiddleware(...reduxMiddlewares)
);

window.STORE = store;

RoomClient.init({ store });

domready(async () => {
  logger.debug("DOM ready");

  await utils.initialize();

  run();
});

async function run() {
  log("run start");
  logger.debug("run() [environment:%s]", process.env.NODE_ENV);

  const urlParser = new UrlParse(window.location.href, true);
  log("urlParser", urlParser);
  const peerId = randomString({ length: 8 }).toLowerCase();
  let roomId = urlParser.query.roomId;
  let displayName =
    urlParser.query.displayName || (cookiesManager.getUser() || {}).displayName;
  const handler = urlParser.query.handler;
  const useSimulcast = urlParser.query.simulcast !== "false";
  const useSharingSimulcast = urlParser.query.sharingSimulcast !== "false";
  const forceTcp = urlParser.query.forceTcp === "true";
  const produce = urlParser.query.produce !== "false";
  const consume = urlParser.query.consume !== "false";
  const forceH264 = urlParser.query.forceH264 === "true";
  const forceVP9 = urlParser.query.forceVP9 === "true";
  const svc = urlParser.query.svc;
  const datachannel = urlParser.query.datachannel !== "false";
  const info = urlParser.query.info === "true";
  const faceDetection = urlParser.query.faceDetection === "true";
  const externalVideo = urlParser.query.externalVideo === "true";
  const throttleSecret = urlParser.query.throttleSecret;
  const e2eKey = urlParser.query.e2eKey;

  // Enable face detection on demand.
  if (faceDetection)
    await faceapi.loadTinyFaceDetectorModel("/resources/face-detector-models");

  if (info) {
    // eslint-disable-next-line require-atomic-updates
    window.SHOW_INFO = true;
  }

  if (throttleSecret) {
    // eslint-disable-next-line require-atomic-updates
    window.NETWORK_THROTTLE_SECRET = throttleSecret;
  }

  if (!roomId) {
    roomId = randomString({ length: 8 }).toLowerCase();

    urlParser.query.roomId = roomId;
    window.history.pushState("", "", urlParser.toString());
  }

  // 유효/공유 가능한 Room URL을 가져옵니다.
  const roomUrlParser = new UrlParse(window.location.href, true);

  for (const key of Object.keys(roomUrlParser.query)) {
    // 일부 사용자 정의 매개변수를 유지하지 마십시오.
    switch (key) {
      case "roomId":
      case "handler":
      case "simulcast":
      case "sharingSimulcast":
      case "produce":
      case "consume":
      case "forceH264":
      case "forceVP9":
      case "forceTcp":
      case "svc":
      case "datachannel":
      case "info":
      case "faceDetection":
      case "externalVideo":
      case "throttleSecret":
      case "e2eKey":
        break;

      default:
        delete roomUrlParser.query[key];
    }
  }
  delete roomUrlParser.hash;

  log("roomUrlParser", roomUrlParser, roomUrlParser.toString());

  const roomUrl = roomUrlParser.toString();

  let displayNameSet;

  // URL 또는 쿠키를 통해 displayName이 제공되면 완료됩니다.
  if (displayName) {
    displayNameSet = true;
  }
  // 그렇지 않으면 임의의 이름을 선택하고 "설정되지 않음"으로 표시하십시오.
  else {
    displayNameSet = false;
    displayName = randomName();
  }

  // 현재 장치 정보를 가져옵니다.
  const device = deviceInfo();
  log("device", device);

  store.dispatch(stateActions.setRoomUrl(roomUrl));

  store.dispatch(stateActions.setRoomFaceDetection(faceDetection));

  store.dispatch(
    stateActions.setMe({ peerId, displayName, displayNameSet, device })
  );

  roomClient = new RoomClient({
    roomId,
    peerId,
    displayName,
    device,
    handlerName: handler,
    useSimulcast,
    useSharingSimulcast,
    forceTcp,
    produce,
    consume,
    forceH264,
    forceVP9,
    svc,
    datachannel,
    externalVideo,
    e2eKey,
  });

  log("roomClient", roomClient, {
    roomId,
    peerId,
    displayName,
    device,
    handlerName: handler,
    useSimulcast,
    useSharingSimulcast,
    forceTcp,
    produce,
    consume,
    forceH264,
    forceVP9,
    svc,
    datachannel,
    externalVideo,
    e2eKey,
  });

  // NOTE: For debugging.
  // eslint-disable-next-line require-atomic-updates
  window.CLIENT = roomClient;
  // eslint-disable-next-line require-atomic-updates
  window.CC = roomClient;

  render(
    <Provider store={store}>
      <RoomContext.Provider value={roomClient}>
        <Room />
      </RoomContext.Provider>
    </Provider>,
    document.getElementById("mediasoup-demo-app-container")
  );
}

// NOTE: Debugging stuff.

window.__sendSdps = function () {
  logger.warn(">>> send transport local SDP offer:");
  logger.warn(roomClient._sendTransport._handler._pc.localDescription.sdp);

  logger.warn(">>> send transport remote SDP answer:");
  logger.warn(roomClient._sendTransport._handler._pc.remoteDescription.sdp);
};

window.__recvSdps = function () {
  logger.warn(">>> recv transport remote SDP offer:");
  logger.warn(roomClient._recvTransport._handler._pc.remoteDescription.sdp);

  logger.warn(">>> recv transport local SDP answer:");
  logger.warn(roomClient._recvTransport._handler._pc.localDescription.sdp);
};

let dataChannelTestInterval = null;

window.__startDataChannelTest = function () {
  let number = 0;

  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);

  dataChannelTestInterval = window.setInterval(() => {
    if (window.DP) {
      view.setUint32(0, number++);
      roomClient.sendChatMessage(buffer);
    }
  }, 100);
};

window.__stopDataChannelTest = function () {
  window.clearInterval(dataChannelTestInterval);

  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);

  if (window.DP) {
    view.setUint32(0, Math.pow(2, 32) - 1);
    window.DP.send(buffer);
  }
};

window.__testSctp = async function ({ timeout = 100, bot = false } = {}) {
  let dp;

  if (!bot) {
    await window.CLIENT.enableChatDataProducer();

    dp = window.CLIENT._chatDataProducer;
  } else {
    await window.CLIENT.enableBotDataProducer();

    dp = window.CLIENT._botDataProducer;
  }

  logger.warn(
    "<<< testSctp: DataProducer created [bot:%s, streamId:%d, readyState:%s]",
    bot ? "true" : "false",
    dp.sctpStreamParameters.streamId,
    dp.readyState
  );

  function send() {
    dp.send(`I am streamId ${dp.sctpStreamParameters.streamId}`);
  }

  if (dp.readyState === "open") {
    send();
  } else {
    dp.on("open", () => {
      logger.warn(
        "<<< testSctp: DataChannel open [streamId:%d]",
        dp.sctpStreamParameters.streamId
      );

      send();
    });
  }

  setTimeout(() => window.__testSctp({ timeout, bot }), timeout);
};

setInterval(() => {
  if (window.CLIENT._sendTransport) {
    window.H1 = window.CLIENT._sendTransport._handler;
    window.PC1 = window.CLIENT._sendTransport._handler._pc;
    window.DP = window.CLIENT._chatDataProducer;
  } else {
    delete window.PC1;
    delete window.DP;
  }

  if (window.CLIENT._recvTransport) {
    window.H2 = window.CLIENT._recvTransport._handler;
    window.PC2 = window.CLIENT._recvTransport._handler._pc;
  } else {
    delete window.PC2;
  }
}, 2000);
