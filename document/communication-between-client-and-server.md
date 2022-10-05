# client와 server간 통신

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

### Signaling, Peers

애플리케이션은 WebSocket을 사용하여 인증된 각 WebSocket 연결을 "Peer"와 연결할 수 있다.

> - mediasoup에는 그 자체로 "Peer"들이 없지만
> - 애플리케이션은 특정 사용자 계정, WebSocket 연결, 메타 데이터, mediasoup transport set들, producer 들, consumer 들을 식별하고 연결할 수 있도록 "Peer"를 정의할 수 있다.

### Device 로딩

client 측 애플리케이션은 server 측 mediasoup 라우터의 RTP 기능을 제공하여 mediasoup device 로드한다.

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

send transport가 생성되면 client 측 애플리케이션에서 여러 오디오 및 비디오 트랙을 생성할 수 있다.

1. 애플리케이션에서 [track](https://www.w3.org/TR/mediacapture-streams/#mediastreamtrack) 가져오기
   - 예: navigator.mediaDevices.getUserMedia() 사용
1. local transport send에서 [transport.produce()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce)를 호출
   - transport.produce()의 최초 호출인 경우 transport는 첫 번째 호출인 경우 transport는 [connect](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-on-connect)을 보낸다.
   - transport는 [produce](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-on-produce)를 내보내므로 애플리케이션이 이벤트 매개변수를 server로 전송하고 server 측에서 [Producer](https://mediasoup.org/documentation/v3/mediasoup/api/#Producer) 인스턴스를 생성한다.
1. transport.produce()는 client 측의 [Producer] 인스턴스를 resolve한다.

### Media 소비(consuming)

수신 transport가 생성되면 client 측 애플리케이션에서 여러 오디오 및 비디오 트랙을 사용할 수 잇다.

`Transports 생성과는 반대로 Media 소비자는 server에서 먼저 생성되어야 한다.`

1. client 애플리케이션은 server에 [device.rtpCapabilities](https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-rtpCapabilities) 신호를 보낸다.(미리 수행했을 수 있음).
1. server 측 애플리케이션은 원격 device가 특정 생산자(생산자 미디어 코덱을 지원하는지 여부)를 사용할 수 있는지 여부를 확인해야 한다.
   - [router.canConsume()](https://mediasoup.org/documentation/v3/mediasoup/api/#router-canConsume) 메서드를 사용하여 수행할 수 있다.
1. server 애플리케이션은 미디어 수신을 위해 생성된 WebRTC 전송 client에서 [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consume)을 호출하여 server 측 [Consumer](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Consumer)를 생성한다.
   - [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consume) 문서의 내용처럼
   - paused: true 설정으로 일시 중지된 상태로 server 측 consumer를 만들고 원격 endpoint에서 생성되면 다시 시작하는 것이 좋다.
1. server 애플리케이션은 local transport 전송에서 [transport.consume()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-consume)을 호출하는 원격 client 애플리케이션에 소비자 정보와 매개변수를 전송한다.
   - transport.consume()에 대한 첫 번째 호출인 경우 transport는 `connect`을 보낸다.
1. transport.consume()은 client 측의 Consumer 인스턴를 resolve한다.

### 데이터 생성(DataChannels)

send transport 가 생성되면 client 측 애플리케이션은 여러 DataChannels를 생성할 수 있다.

- 애플리케이션은 local send transport에서 [transport.produceData()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-producedata)를 호출한다.

### 데이터 소비(DataChannels)

수신 전송이 생성되면 client 측 애플리케이션에서 여러 DataChannel을 사용할 수 있습니다.

데이터 생성(DataChannels) 과 반대의 순서로 consumer 는 server에서 먼저 생성되어야 한다.

1. server 애플리케이션은 수신을 위해 생성된 WebRTC 전송에서 [transport.consumeData()](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-consumedata)를 호출하여 server 측 [DataConsumer](https://mediasoup.org/documentation/v3/mediasoup-client/api/#DataConsumer)를 생성한다.
1. server 애플리케이션은 로컬 수신 전송에서 transport.consumeData()를 호출하는 client 애플리케이션에 소비자 정보와 매개변수를 전송한다.
   - 이것이 [transport.consumeData()](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-consumedata)에 대한 첫 번째 호출인 경우 전송은 [connect](https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-on-connect)을 내보낸다.
1. transport.consumeData()는 client 측의 [DataConsumer](https://mediasoup.org/documentation/v3/mediasoup-client/api/#Consumer) 인스턴스로 해결된다.

### Actions 커뮤니케이션과 Events

> - 핵심 원칙은 메서드를 호출하면 mediasoup 인스턴스가 해당 인스턴스에서 직접적인 이벤트를 생성하지 않는다.
> - 이것은 router, transport, producer, consumer, data producer 또는 data consumer에서 close()를 호출해도 이벤트가 트리거되지 않는다는 것을 의미한다.

transport, producer, consumer, data producer 또는 data consumer가 client 또는 server 측에서 close 될 때(예: close() 호출) 애플리케이션은 해당 엔터티에 대해 close()를 호출해야 하는 다른 쪽에도 종료 신호를 보내야 한다.<br />
server 측 애플리케이션은 다음 클로저 이벤트를 수신 대기하고 이에 대해 client에 알려야 한다.

- Transport [routerclose](https://mediasoup.org/documentation/v3/mediasoup/api/#transport-on-routerclose)
  - client는 해당 local transport에서 close()를 호출해야 한다.
- Producer [transportclose](https://mediasoup.org/documentation/v3/mediasoup/api/#producer-on-transportclose)
  - client는 해당 local producer에서 close()를 호출해야 한다.
- Consumer [transportclose](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-on-transportclose)
  - client는 해당 local consumer에서 close()를 호출해야 한다.
- Consumer [producerclose](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-on-producerclose)
  - client는 해당 local consumer에서 close()를 호출해야 한다.
- DataProducer [transportclose](https://mediasoup.org/documentation/v3/mediasoup/api/#dataProducer-on-transportclose)
  - client는 해당 local data producer에서 close()를 호출해야 한다.
- DataConsumer [transportclose](https://mediasoup.org/documentation/v3/mediasoup/api/#dataConsumer-on-transportclose)
  - client는 해당 local data consumer에서 close()를 호출해야 한다.
- DataConsumer [dataproducerclose](https://mediasoup.org/documentation/v3/mediasoup/api/#dataConsumer-on-dataproducerclose)
  - client는 해당 local data consumer에서 close()를 호출해야 한다.

client 또는 server 측에서 RTP 생산자 또는 소비자를 일시 중지할 때도 동일하다.<br />
action은 상대방에게 signal를 보내야 한다.<br />
또한 server 측 애플리케이션은 다음 이벤트를 수신 대기하고 client에 알려야한다.

- Consumer [producerpause](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-on-producerpause)
  - client는 local transport에서 pause()를 호출해야 한다.
- Consumer [producerresume](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-on-producerresume)
  - client는 local transport에서 resume()을 호출해야 한다.
  - consumer 가 의도적으로 일시 중지된 경우는 제외

동시 방송 또는 SVC가 사용 중일 때 애플리케이션은 client와 server 측 consumer 사이에 선호 계층과 유효 계층 신호를 보내는 데 관심이 있을 수 있다.

- server 측 애플리케이션은 [consumer.setPreferredLayers()](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-setPreferredLayers)를 통해 consumer 선호 계층을 설정한다.
- server 측 consumer는 [layerschange](https://mediasoup.org/documentation/v3/mediasoup/api/#consumer-on-layerschange) 이벤트를 구독하고 클라이언트 애플리케이션에 전송 중인 유효 계층에 대해 알린다.
