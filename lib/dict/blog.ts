export const blog = {
  pt: {
    // Blog index
    "blog.eyebrow": "Blog",
    "blog.title": "Novidades e guias",
    "blog.subtitle": "Conteúdo sobre infraestrutura, performance e segurança.",
    "blog.readArticle": "Ler artigo",

    // Post page
    "blog.back": "Voltar para o blog",
    "blog.cta.title": "Pronto para começar?",
    "blog.cta.subtitle": "Suba sua VPS na ArtixCloud em menos de um minuto.",
    "blog.cta.button": "Criar conta",

    // Shared
    "blog.author": "Equipe ArtixCloud",

    // Categories
    "blog.category.guia": "Guia",
    "blog.category.seguranca": "Segurança",
    "blog.category.produto": "Produto",

    // Post: como-escolher-sua-vps
    "blog.post.como-escolher-sua-vps.title":
      "Como escolher a VPS ideal para o seu projeto",
    "blog.post.como-escolher-sua-vps.excerpt":
      "vCPU, RAM, disco e rede: um guia direto para dimensionar sua máquina sem pagar a mais nem ficar sem recurso.",
    "blog.post.como-escolher-sua-vps.category": "Guia",
    "blog.post.como-escolher-sua-vps.date": "20 de junho de 2026",
    "blog.post.como-escolher-sua-vps.body1":
      "Escolher uma VPS começa por entender a carga da sua aplicação. CPU é o gargalo de aplicações que processam muito (APIs, jogos), enquanto memória costuma limitar bancos de dados e caches.",
    "blog.post.como-escolher-sua-vps.body2":
      "Para a maioria dos projetos web, comece com 2 a 4 vCPUs e 4 a 8 GB de RAM. Monitore o uso real por algumas semanas antes de escalar — é mais barato subir de plano do que provisionar grande demais.",
    "blog.post.como-escolher-sua-vps.body3":
      "Disco NVMe faz diferença enorme em I/O. Se sua aplicação lê e escreve muito (bancos, filas), priorize NVMe sobre SSD comum.",
    "blog.post.como-escolher-sua-vps.body4":
      "Por fim, considere rede e latência: hospedar perto dos seus usuários reduz o tempo de resposta de forma perceptível.",

    // Post: anti-ddos-na-pratica
    "blog.post.anti-ddos-na-pratica.title":
      "Anti-DDoS na prática: o que realmente protege",
    "blog.post.anti-ddos-na-pratica.excerpt":
      "Entenda as camadas L3/L4/L7 e por que mitigação automática é essencial para manter seu serviço no ar.",
    "blog.post.anti-ddos-na-pratica.category": "Segurança",
    "blog.post.anti-ddos-na-pratica.date": "11 de junho de 2026",
    "blog.post.anti-ddos-na-pratica.body1":
      "Ataques DDoS variam de inundações volumétricas (L3/L4) a ataques sofisticados na camada de aplicação (L7). Cada um exige uma estratégia de mitigação diferente.",
    "blog.post.anti-ddos-na-pratica.body2":
      "Mitigação volumétrica acontece na borda da rede, absorvendo e filtrando o tráfego antes que ele chegue à sua máquina. Já ataques L7 exigem análise de comportamento e regras adaptativas.",
    "blog.post.anti-ddos-na-pratica.body3":
      "Na ArtixCloud, a proteção anti-DDoS é automática e inclusa em todos os planos — você não precisa configurar nada para estar protegido.",

    // Post: deploy-em-60-segundos
    "blog.post.deploy-em-60-segundos.title":
      "Deploy em 60 segundos: do clique ao servidor online",
    "blog.post.deploy-em-60-segundos.excerpt":
      "Um tour pelo nosso fluxo de provisionamento e dicas para colocar sua stack no ar rapidamente.",
    "blog.post.deploy-em-60-segundos.category": "Produto",
    "blog.post.deploy-em-60-segundos.date": "2 de junho de 2026",
    "blog.post.deploy-em-60-segundos.body1":
      "Provisionar uma VPS deveria ser instantâneo. Nosso pipeline cria, configura a rede e entrega acesso root em menos de um minuto.",
    "blog.post.deploy-em-60-segundos.body2":
      "Depois de online, use imagens prontas ou scripts de inicialização para automatizar a instalação da sua stack.",
    "blog.post.deploy-em-60-segundos.body3":
      "Combine snapshots automáticos com infraestrutura como código e você terá um ambiente reproduzível e seguro.",

    // Status page
    "status.allOperational": "Todos os sistemas operacionais",
    "status.avgUptime":
      "Disponibilidade média de 99.98% nos últimos 90 dias.",
    "status.components": "Componentes",
    "status.component.api": "API",
    "status.component.panel": "Painel de controle",
    "status.component.network": "Rede (São Paulo)",
    "status.component.provisioning": "Provisionamento de VPS",
    "status.component.backups": "Backups",
    "status.component.antiddos": "Mitigação Anti-DDoS",
    "status.operational": "Operacional",
    "status.uptime90": "Disponibilidade · 90 dias",
    "status.daysAgo": "90 dias atrás",
    "status.today": "hoje",
    "status.incidentHistory": "Histórico de incidentes",
    "status.statusResolved": "Resolvido",
    "status.statusDone": "Concluído",
    "status.incident1.date": "12 de junho de 2026",
    "status.incident1.title": "Lentidão intermitente no painel",
    "status.incident1.detail":
      "Identificamos lentidão no painel por ~14 min devido a um pico de tráfego. Mitigado com escalonamento automático.",
    "status.incident2.date": "28 de maio de 2026",
    "status.incident2.title": "Manutenção programada de rede",
    "status.incident2.detail":
      "Janela de manutenção planejada sem impacto perceptível aos clientes.",
  },
  en: {
    // Blog index
    "blog.eyebrow": "Blog",
    "blog.title": "News and guides",
    "blog.subtitle": "Content about infrastructure, performance and security.",
    "blog.readArticle": "Read article",

    // Post page
    "blog.back": "Back to the blog",
    "blog.cta.title": "Ready to get started?",
    "blog.cta.subtitle": "Spin up your VPS on ArtixCloud in under a minute.",
    "blog.cta.button": "Create account",

    // Shared
    "blog.author": "ArtixCloud Team",

    // Categories
    "blog.category.guia": "Guide",
    "blog.category.seguranca": "Security",
    "blog.category.produto": "Product",

    // Post: como-escolher-sua-vps
    "blog.post.como-escolher-sua-vps.title":
      "How to choose the ideal VPS for your project",
    "blog.post.como-escolher-sua-vps.excerpt":
      "vCPU, RAM, disk and network: a straightforward guide to size your machine without overpaying or running short on resources.",
    "blog.post.como-escolher-sua-vps.category": "Guide",
    "blog.post.como-escolher-sua-vps.date": "June 20, 2026",
    "blog.post.como-escolher-sua-vps.body1":
      "Choosing a VPS starts with understanding your application's workload. CPU is the bottleneck for compute-heavy applications (APIs, games), while memory tends to limit databases and caches.",
    "blog.post.como-escolher-sua-vps.body2":
      "For most web projects, start with 2 to 4 vCPUs and 4 to 8 GB of RAM. Monitor real usage for a few weeks before scaling — it's cheaper to move up a plan than to provision too large.",
    "blog.post.como-escolher-sua-vps.body3":
      "NVMe disk makes a huge difference in I/O. If your application reads and writes a lot (databases, queues), prioritize NVMe over standard SSD.",
    "blog.post.como-escolher-sua-vps.body4":
      "Finally, consider network and latency: hosting close to your users noticeably reduces response time.",

    // Post: anti-ddos-na-pratica
    "blog.post.anti-ddos-na-pratica.title":
      "Anti-DDoS in practice: what really protects you",
    "blog.post.anti-ddos-na-pratica.excerpt":
      "Understand the L3/L4/L7 layers and why automatic mitigation is essential to keep your service online.",
    "blog.post.anti-ddos-na-pratica.category": "Security",
    "blog.post.anti-ddos-na-pratica.date": "June 11, 2026",
    "blog.post.anti-ddos-na-pratica.body1":
      "DDoS attacks range from volumetric floods (L3/L4) to sophisticated application-layer attacks (L7). Each one requires a different mitigation strategy.",
    "blog.post.anti-ddos-na-pratica.body2":
      "Volumetric mitigation happens at the network edge, absorbing and filtering traffic before it reaches your machine. L7 attacks, on the other hand, require behavior analysis and adaptive rules.",
    "blog.post.anti-ddos-na-pratica.body3":
      "At ArtixCloud, anti-DDoS protection is automatic and included in every plan — you don't need to configure anything to stay protected.",

    // Post: deploy-em-60-segundos
    "blog.post.deploy-em-60-segundos.title":
      "Deploy in 60 seconds: from click to live server",
    "blog.post.deploy-em-60-segundos.excerpt":
      "A tour through our provisioning flow and tips to get your stack online quickly.",
    "blog.post.deploy-em-60-segundos.category": "Product",
    "blog.post.deploy-em-60-segundos.date": "June 2, 2026",
    "blog.post.deploy-em-60-segundos.body1":
      "Provisioning a VPS should be instant. Our pipeline creates the machine, configures the network and delivers root access in under a minute.",
    "blog.post.deploy-em-60-segundos.body2":
      "Once online, use ready-made images or startup scripts to automate the installation of your stack.",
    "blog.post.deploy-em-60-segundos.body3":
      "Combine automatic snapshots with infrastructure as code and you'll have a reproducible, secure environment.",

    // Status page
    "status.allOperational": "All systems operational",
    "status.avgUptime": "Average uptime of 99.98% over the last 90 days.",
    "status.components": "Components",
    "status.component.api": "API",
    "status.component.panel": "Control panel",
    "status.component.network": "Network (São Paulo)",
    "status.component.provisioning": "VPS provisioning",
    "status.component.backups": "Backups",
    "status.component.antiddos": "Anti-DDoS mitigation",
    "status.operational": "Operational",
    "status.uptime90": "Uptime · 90 days",
    "status.daysAgo": "90 days ago",
    "status.today": "today",
    "status.incidentHistory": "Incident history",
    "status.statusResolved": "Resolved",
    "status.statusDone": "Completed",
    "status.incident1.date": "June 12, 2026",
    "status.incident1.title": "Intermittent slowness in the panel",
    "status.incident1.detail":
      "We identified slowness in the panel for ~14 min due to a traffic spike. Mitigated with automatic scaling.",
    "status.incident2.date": "May 28, 2026",
    "status.incident2.title": "Scheduled network maintenance",
    "status.incident2.detail":
      "Planned maintenance window with no noticeable impact on customers.",
  },
  es: {
    // Blog index
    "blog.eyebrow": "Blog",
    "blog.title": "Novedades y guías",
    "blog.subtitle":
      "Contenido sobre infraestructura, rendimiento y seguridad.",
    "blog.readArticle": "Leer artículo",

    // Post page
    "blog.back": "Volver al blog",
    "blog.cta.title": "¿Listo para empezar?",
    "blog.cta.subtitle": "Lanza tu VPS en ArtixCloud en menos de un minuto.",
    "blog.cta.button": "Crear cuenta",

    // Shared
    "blog.author": "Equipo ArtixCloud",

    // Categories
    "blog.category.guia": "Guía",
    "blog.category.seguranca": "Seguridad",
    "blog.category.produto": "Producto",

    // Post: como-escolher-sua-vps
    "blog.post.como-escolher-sua-vps.title":
      "Cómo elegir la VPS ideal para tu proyecto",
    "blog.post.como-escolher-sua-vps.excerpt":
      "vCPU, RAM, disco y red: una guía directa para dimensionar tu máquina sin pagar de más ni quedarte sin recursos.",
    "blog.post.como-escolher-sua-vps.category": "Guía",
    "blog.post.como-escolher-sua-vps.date": "20 de junio de 2026",
    "blog.post.como-escolher-sua-vps.body1":
      "Elegir una VPS comienza por entender la carga de tu aplicación. La CPU es el cuello de botella de las aplicaciones con mucho procesamiento (APIs, juegos), mientras que la memoria suele limitar las bases de datos y las cachés.",
    "blog.post.como-escolher-sua-vps.body2":
      "Para la mayoría de los proyectos web, empieza con 2 a 4 vCPUs y 4 a 8 GB de RAM. Monitorea el uso real durante algunas semanas antes de escalar — es más barato subir de plan que aprovisionar demasiado grande.",
    "blog.post.como-escolher-sua-vps.body3":
      "El disco NVMe marca una enorme diferencia en E/S. Si tu aplicación lee y escribe mucho (bases de datos, colas), prioriza NVMe sobre el SSD común.",
    "blog.post.como-escolher-sua-vps.body4":
      "Por último, considera la red y la latencia: alojar cerca de tus usuarios reduce el tiempo de respuesta de forma perceptible.",

    // Post: anti-ddos-na-pratica
    "blog.post.anti-ddos-na-pratica.title":
      "Anti-DDoS en la práctica: lo que realmente protege",
    "blog.post.anti-ddos-na-pratica.excerpt":
      "Entiende las capas L3/L4/L7 y por qué la mitigación automática es esencial para mantener tu servicio en línea.",
    "blog.post.anti-ddos-na-pratica.category": "Seguridad",
    "blog.post.anti-ddos-na-pratica.date": "11 de junio de 2026",
    "blog.post.anti-ddos-na-pratica.body1":
      "Los ataques DDoS van desde inundaciones volumétricas (L3/L4) hasta ataques sofisticados en la capa de aplicación (L7). Cada uno exige una estrategia de mitigación diferente.",
    "blog.post.anti-ddos-na-pratica.body2":
      "La mitigación volumétrica ocurre en el borde de la red, absorbiendo y filtrando el tráfico antes de que llegue a tu máquina. Los ataques L7, en cambio, requieren análisis de comportamiento y reglas adaptativas.",
    "blog.post.anti-ddos-na-pratica.body3":
      "En ArtixCloud, la protección anti-DDoS es automática y está incluida en todos los planes — no necesitas configurar nada para estar protegido.",

    // Post: deploy-em-60-segundos
    "blog.post.deploy-em-60-segundos.title":
      "Deploy en 60 segundos: del clic al servidor en línea",
    "blog.post.deploy-em-60-segundos.excerpt":
      "Un recorrido por nuestro flujo de aprovisionamiento y consejos para poner tu stack en línea rápidamente.",
    "blog.post.deploy-em-60-segundos.category": "Producto",
    "blog.post.deploy-em-60-segundos.date": "2 de junio de 2026",
    "blog.post.deploy-em-60-segundos.body1":
      "Aprovisionar una VPS debería ser instantáneo. Nuestro pipeline crea la máquina, configura la red y entrega acceso root en menos de un minuto.",
    "blog.post.deploy-em-60-segundos.body2":
      "Una vez en línea, usa imágenes listas o scripts de inicio para automatizar la instalación de tu stack.",
    "blog.post.deploy-em-60-segundos.body3":
      "Combina snapshots automáticos con infraestructura como código y tendrás un entorno reproducible y seguro.",

    // Status page
    "status.allOperational": "Todos los sistemas operativos",
    "status.avgUptime":
      "Disponibilidad media del 99.98% en los últimos 90 días.",
    "status.components": "Componentes",
    "status.component.api": "API",
    "status.component.panel": "Panel de control",
    "status.component.network": "Red (São Paulo)",
    "status.component.provisioning": "Aprovisionamiento de VPS",
    "status.component.backups": "Copias de seguridad",
    "status.component.antiddos": "Mitigación Anti-DDoS",
    "status.operational": "Operativo",
    "status.uptime90": "Disponibilidad · 90 días",
    "status.daysAgo": "hace 90 días",
    "status.today": "hoy",
    "status.incidentHistory": "Historial de incidentes",
    "status.statusResolved": "Resuelto",
    "status.statusDone": "Completado",
    "status.incident1.date": "12 de junio de 2026",
    "status.incident1.title": "Lentitud intermitente en el panel",
    "status.incident1.detail":
      "Identificamos lentitud en el panel durante ~14 min debido a un pico de tráfico. Mitigado con escalado automático.",
    "status.incident2.date": "28 de mayo de 2026",
    "status.incident2.title": "Mantenimiento programado de red",
    "status.incident2.detail":
      "Ventana de mantenimiento planificada sin impacto perceptible para los clientes.",
  },
} as const;
