# Built in

## 로컬 유저 미디어

- 로컬 환경 `유저 비디오/오디오 미디어` 가져오기
- navigator.mediaDevices`.getUserMedia()` 반환 값

```ts
const localUserMedia: Promise<MediaStream> =
  navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
```

### 로컬 유저 비디오 트랙

- 로컬 환경 `유저 비디오 트랙` 가져오기
- navigator.mediaDevices.getUserMedia()`.getVideoTracks()` 반환 값

```ts
navigator.mediaDevices.getUserMedia().then((media: MediaStream) => {
  // 로컬 유저 비디오 트랙
  console.log(media.getVideoTracks()[0]);
});
```

### 로컬 유저 오디오 트랙

- 로컬 환경 `유저 오디오 트랙` 가져오기
- navigator.mediaDevices.getUserMedia()`.getAudioTracks()` 반환 값

```ts
navigator.mediaDevices.getUserMedia().then((media: MediaStream) => {
  // 로컬 유저 오디오 트랙
  console.log(media.getAudioTracks()[0]);
});
```

## 로컬 디스플레이 미디어

- 로컬 환경 `디스플레이 비디오/오디오 미디어` 가져오기
- navigator.mediaDevices`.getDisplayMedia()` 반환 값

```ts
const localDisplayMedia: Promise<MediaStream> =
  navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
```

### 로컬 디스플레이 비디오 트랙

- 로컬 환경 `디스플레이 비디오 트랙` 가져오기
- navigator.mediaDevices.getDisplayMedia()`.getVideoTracks()` 반환 값

```ts
navigator.mediaDevices.getDisplayMedia().then((media: MediaStream) => {
  // 로컬 디스플레이 비디오 트랙
  console.log(media.getVideoTracks()[0]);
});
```

### 로컬 디스플레이 오디오 트랙

- 로컬 환경 `디스플레이 오디오 트랙` 가져오기
- navigator.mediaDevices.getDisplayMedia()`.getAudioTracks()` 반환 값

```ts
navigator.mediaDevices.getDisplayMedia().then((media: MediaStream) => {
  // 로컬 디스플레이 오디오 트랙
  console.log(media.getAudioTracks()[0]);
});
```

### 디바이스 목록

- navigator.mediaDevices.enumerateDevices() 반환 값
- 모든 장치 목록을 불러온다(video, audio)

```ts
navigator.mediaDevices.enumerateDevices().then((r: InputDeviceInfo[]) => {
  console.log(r);
});
```

---

# Mediasoup Client

## 미디어숲 디바이스

- mediasoup.Device() 반환 값
- 디바이스 클래스
- 새로운 디바이스 생성
- 여러 기능 제공
  - 장치 로드/로드 여부,
  - send/receive Transport 생성 등

```ts
const device = new mediasoup.Device();

// 디바이스 초기화
device.load({ routerRtpCapabilities });
```

## Transport

- 운송기(전송/수신)

### Send Transport

- 데이터 전송기

```ts
const device = new mediasoup.Device();
const transportOptions = await transport_옵션_요청();

// 데이터 전송기 생성
const sendTransport = await device.createSendTransport(transportOptions);
```

#### Producer

- sendTransport.produce()를 통해 생성
- 전달되는 인자의 종류에 맞는 producer 생성

```ts
// 로컬 유저 미디어
const localUserMedia = await getUserMedia({
  video: true,
  audio: true,
});

// 로컬 유저 미디어 - 비디오 producer
const localUserVideoProducer = await sendTransport.produce({
  track: localUserMedia.getVideoTracks()[0],
  encodings: camEncodings(),
  appData: { mediaTag: "cam-video" },
});

// 로컬 유저 미디어 - 오디오 producer
const localUserAudioProducer = await sendTransport.produce({
  track: localUserMedia.getAudioTracks()[0],
  appData: { mediaTag: "cam-audio" },
});

// 로컬 디스플레이 미디어
const localDisplayMedia = await navigator.mediaDevices.getDisplayMedia({
  video: true,
  audio: true,
});

// 로컬 디스플레이 미디어 - 비디오 producer
localDisplayVideoProducer = await sendTransport.produce({
  track: localDisplayMedia.getVideoTracks()[0],
  encodings: null,
  appData: { mediaTag: "screen-video" },
});

// 로컬 디스플레이 미디어 - 오디오 producer
localDisplayAudioProducer = await sendTransport.produce({
  track: localDisplayMedia.getAudioTracks()[0],
  appData: { mediaTag: "screen-audio" },
});
```

```ts
// 일시 정지
localUserVideoProducer.pause();

// 전송하는 track 교체
localUserVideoProducer.replaceTrack({
  track: localUserMedia.getVideoTracks()[0],
});
localUserAudioProducer.replaceTrack({
  track: localUserMedia.getAudioTracks()[0],
});

// track 설정 정보 가져오기
const { deviceId } = localUserAudioProducer.track.getSettings();
console.log(deviceId);

// 동시 방송에서 서버로 전송되는 가장 높은 RTP 스트림 제한
localUserAudioProducer.setMaxSpatialLayer();
```

### Receive Transport

- 데이터 수신기

```ts
const device = new mediasoup.Device();
const transportOptions = await transport_옵션_요청();

// 데이터 수신기 생성
const receiveTransport = await device.createRecvTransport(transportOptions);
```

#### Consumer

- receiveTransport.consume()를 통해 생성
- 전달되는 인자의 종류에 맞는 consumer 생성

```ts
const consumerParameters = await receiveTrack_파라미터_요청({
  mediaTag: mediaTag,
  mediaPeerId: peerId,
  rtpCapabilities: device.rtpCapabilities,
});
const consumer = await recvTransport.consume({
  ...consumerParameters,
  appData: { peerId, mediaTag },
});

// 비디오 또는 오디오 소비
const el = document.createElement(consumer.kind);
el.srcObject = new MediaStream([consumer.track.clone()]);

// 일시 정지
consumer.pause();

// 재시작
consumer.resume();

// 닫기
consumer.close();
```
