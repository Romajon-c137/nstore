declare module 'sigex-qr-signing-client' {
  /** Клиент QR-подписания SIGEX (eGov Mobile). Работает в браузере. */
  export class QRSigningClientCMS {
    /**
     * @param description описание процедуры подписания (видит пользователь в eGov Mobile)
     * @param attach вкладывать ли подписываемые данные в CMS (CMS_WITH_DATA), по умолчанию false
     * @param baseUrl базовый URL сервиса SIGEX, по умолчанию 'https://sigex.kz'
     */
    constructor(description: string, attach?: boolean, baseUrl?: string)

    /** Ссылка SIGEX на процедуру подписания (референс для хранения). Доступна после registerQRSinging(). */
    signURL?: string
    dataURL?: string

    addDataToSign(names: string[], dataBase64: string, meta?: unknown[], isPDF?: boolean): Promise<void>
    /** @returns QR-код (PNG/GIF) в base64 */
    registerQRSinging(): Promise<string>
    getQR(): string
    getEGovMobileLaunchLink(): string
    getEGovBusinessLaunchLink(): string
    /** @returns массив CMS-подписей (base64) под зарегистрированными блоками данных */
    getSignatures(dataSentCallback?: () => void, debugErrorsCallback?: (e: unknown) => void): Promise<string[]>
  }

  export class QRSigningError extends Error {
    details?: string
  }
}
