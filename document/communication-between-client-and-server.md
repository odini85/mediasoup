# client와 server간 통신

mediasoup은 client와 server간 통신을 위한 signal 프로토콜을 제공하지 않는다.

WebSocket, HTTP 등을 사용하여 통신해야한다.

client와 server간 mediasoup 매개변수/요청/응답/알림을 교환하는 것은 애플리케이션에서 구현해야한다.

대부분 양방향 통신이므로 전이중 채널이 필요하다.

애플리케이션은 mediasoup과 관련되지 않은 메시지 교환(예: 인증 절차, 채팅 메시지, 파일 전송 등)을 위해 동일한 채널을 이용할 수 있다.

## mediasoup-client 및 libmediasoupclient 가이드
