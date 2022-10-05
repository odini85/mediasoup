# 클라이언트와 server간의 통신

mediasoup은 client와 server간 통신을 위한 signal 프로토콜을 제공하지 않는다.

WebSocket, HTTP 등을 사용하여 통신해야한다.

client와 server간 mediasoup 매개변수/요청/응답/알림을 교환하는 것은 애플리케이션에서 구현해야한다.

대부분 양방향 통신이므로 전이중 채널이 필요하다.

애플리케이션은 mediasoup과 관련되지 않은 메시지 교환(예: 인증 절차, 채팅 메시지, 파일 전송 등)을 위해 동일한 채널을 이용할 수 있다.

## mediasoup-client 및 libmediasoupclient 가이드

JavaScript 또는 C++ client 측 애플리케이션이 server에서 미리 생성한 mediasoup [Router](https://mediasoup.org/documentation/v3/mediasoup/api/#Router)에 연결하고

WebRTC를 통해 미디어를 주고 받기 위해 mediasoup-client [Device](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device) 개체를 인스턴스화 하는 과정을 설명한다.<br />
(libmediasoupclient [Device](https://mediasoup.org/documentation/v3/libmediasoupclient/api/#Device)도 동일하다)

> mediasoup-client 는 mediasoup에 적합한 [RTP](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/) 매개변수를 생성하기 때문에 client 측 애플리케이션 개발을 단순화 한다.

### Signaling and Peers

애플리케이션은 WebSocket을 사용하여 인증된 각 WebSocket 연결을 "Peer"와 연결할 수 있다.

> - mediasoup에는 그 자체로 "Peer"들이 없지만
> - 애플리케이션은 특정 사용자 계정, WebSocket 연결, 메타 데이터, mediasoup transport set들, producer 들, consumer 들을 식별하고 연결할 수 있도록 "Peer"를 정의할 수 있다.

### Device 로딩

클라이언트 측 응용 프로그램은 server 측 미디어 수프 라우터의 RTP 기능을 제공하여 미디어 수프 장치를 로드한다.

[device.load()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load) 참조

### Transports 생성

mediasoup-client 는 미디어 송수신을 위해 별도의 WebRTC 전송이 필요하다.

일반적으로 client 애플리케이션은 미디어를 보내거나 받기에 전 transport를 생성한다.

#### 미디어 보내기

1. WebRTC transport는 먼저 mediasoup 라우터에서 생성되어야 한다.
   - [router.createWebRtcTransport()](https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport)
1. client 측 애플리케이션에서 replicated(복제) 한다.
   - [device.createSendTransport()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createSendTransport)
1. client 애플리케이션은 local transport 에서 `connect`, `produce` 이벤트를 구독한다.

#### 미디어 받기

1. WebRTC transport는 먼저 mediasoup 라우터에서 생성되어야 한다.
   - [router.createWebRtcTransport()](https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport)
1. client 측 애플리케이션에서 replicated(복제) 한다.
   - [device.createRecvTransport()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport)
1. client 애플리케이션은 local transport 에서 `connect` 이벤트를 구독한다.

> - SCTP(WebRTC의 DataChannel)가 해당 전송에서 필요한 경우
> - 해당 전송에서 enableSctp(적절한 numSctpStreams 포함) 및 기타 SCTP 관련 설정을 활성화해야 한다.

### Media 제작

transport가 생성되면 client 측 애플리케이션에서 여러 오디오 및 비디오 트랙을 생성할 수 있다.

1. 애플리케이션에서 [track](https://www.w3.org/TR/mediacapture-streams/#mediastreamtrack) 가져오기
   - 예: navigator.mediaDevices.getUserMedia() 사용
1. local transport 에서 [transport.produce()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce)를 호출
   - transport.produce()의 최초 호출인 경우 transport는 첫 번째 호출인 경우 transport는 [connect](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-on-connect)을 보낸다.
   - transport는 [produce](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-on-produce)를 내보내므로 애플리케이션이 이벤트 매개변수를 server로 전송하고 server 측에서 [Producer](https://mediasoup.org/documentation/v3/mediasoup/api/#Producer) 인스턴스를 생성한다.
1. transport.produce()는 client 측의 [Producer] 인스턴스를 resolve한다.

### Media 소비(consuming)

수신 transport가 생성되면 client 측 애플리케이션에서 여러 오디오 및 비디오 트랙을 사용할 수 잇다.

`Transports 생성과는 반대로 Media 소비자는 server에서 먼저 생성되어야 한다.`

1. client 애플리케이션은 server에 [device.rtpCapabilities](https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-rtpCapabilities) 신호를 보낸다.(미리 수행했을 수 있음).
1. server 측 애플리케이션은 원격 장치가 특정 생산자(생산자 미디어 코덱을 지원하는지 여부)를 사용할 수 있는지 여부를 확인해야 한다.
   - [router.canConsume()](https://mediasoup.org/documentation/v3/mediasoup/api/#router-canConsume) 메서드를 사용하여 수행할 수 있다.
1. server 애플리케이션은 미디어 수신을 위해 생성된 WebRTC 전송 클라이언트에서 [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consume)을 호출하여 server 측 [Consumer](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Consumer)를 생성한다.
   - [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consume) 문서의 내용처럼
   - paused: true 설정으로 일시 중지된 상태로 server 측 consumer를 만들고 원격 endpoint에서 생성되면 다시 시작하는 것이 좋다.
1. server 애플리케이션은 local transport 전송에서 [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-consume)을 호출하는 원격 client 애플리케이션에 소비자 정보와 매개변수를 전송합니다.
   - transport.consume()에 대한 첫 번째 호출인 경우 transport는 `connect`을 보낸다.
1. transport.consume()은 client 측의 Consumer 인스턴fmf resolve한다.
