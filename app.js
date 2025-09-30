// Ana uygulama dosyası
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');

// Veritabanı modellerini yükle
const db = require('./models');

// Express uygulamasını oluştur
const app = express();

// Middleware'ler
app.use(express.json()); // JSON verilerini işlemek için
app.use(express.urlencoded({ extended: true })); // Form verilerini işlemek için
app.use(express.static(path.join(__dirname, 'public'))); // Statik dosyalar için

// Oturum (session) ayarları
app.use(session({
    secret: process.env.SESSION_SECRET || 'quiz_app_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 1 gün
    }
}));

// View engine ayarları
app.set('view engine', 'ejs'); // EJS template engine kullanılacak
app.set('views', path.join(__dirname, 'views')); // View dosyalarının konumu

/**
 * Veritabanı bağlantısını ve senkronizasyonu yöneten fonksiyon
 * Bu fonksiyon uygulama başladığında çalıştırılır
 */
const veritabaniBaglantisiniBaslat = async () => {
    try {
        // Veritabanına bağlan
        await db.sequelize.authenticate();
        console.log('✅ Veritabanı bağlantısı başarılı.');
        
        // Modelleri veritabanı ile senkronize et
        // alter: false -> Mevcut tablolara dokunma, sadece yeni tabloları oluştur
        await db.sequelize.sync({
            alter: false,
            logging: console.log,  // SQL sorgularını görmek için
            // Zaman damgalarını manuel olarak yöneteceğiz
            define: {
                timestamps: false  // Otomatik timestamp oluşturmayı devre dışı bırak
            }
        });
        console.log('🔄 Veritabanı modelleri güvenli şekilde güncellendi.');
    } catch (hata) {
        console.error('❌ Veritabanı hatası:', hata);
        process.exit(1); // Hata durumunda uygulamayı sonlandır
    }
};

// Veritabanı bağlantısını başlat
veritabaniBaglantisiniBaslat();

// Oturum kontrolü için middleware
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
};

// Kullanıcı bilgilerini template'lere aktar
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Ana sayfa
app.get('/', (req, res) => {
    res.render('index');
});

// Giriş sayfası
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login');
});

// Giriş işlemi
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.User.findOne({ where: { email } });

        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ 
                success: false, 
                message: 'E-posta veya şifre hatalı!' 
            });
        }

        // Oturum bilgilerini kaydet
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email
        };

        // Doğrudan yönlendirme yap
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Giriş hatası:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Giriş sırasında bir hata oluştu' 
        });
    }
});

// Kayıt sayfası
app.get('/register', (req, res) => {    
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('register', { 
        title: 'Kayıt Ol',
        error: null 
    });
});

// Kayıt işlemi
app.post('/register', async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;
        
        // Şifre kontrolü
        if (password !== confirmPassword) {
            return res.render('register', { 
                title: 'Kayıt Ol',
                error: 'Şifreler eşleşmiyor!' 
            });
        }

        // Kullanıcı var mı kontrol et
        const existingUser = await db.User.findOne({ where: { email } });
        if (existingUser) {
            return res.render('register', { 
                title: 'Kayıt Ol',
                error: 'Bu e-posta adresi zaten kullanılıyor!' 
            });
        }

        // Yeni kullanıcı oluştur
        const user = await db.User.create({
            username,
            email,
            password // Modeldeki hook otomatik olarak şifreleyecek
        });

        // Oturum aç
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email
        };

        // Başarılı kayıt sonrası yönlendirme
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Kayıt hatası:', error);
        res.render('register', { 
            title: 'Kayıt Ol',
            error: 'Kayıt sırasında bir hata oluştu!' 
        });
    }
});



// Dashboard sayfası
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('dashboard', { user: req.session.user });
});

// Çıkış işlemi
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Çıkış yapılırken hata oluştu:', err);
        }
        res.redirect('/login');
    });
});

// Quiz oluşturma sayfası
app.get('/quiz/olustur', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    
    try {
        // createdAt - created_at
        const categories = await db.Category.findAll({
  attributes: ['id', 'name'],
});
        res.render('quiz-olustur', { 
            title: 'Yeni Quiz Oluştur',
            categories,
            user: req.session.user
        });
    } catch (error) {
        console.error('Kategoriler yüklenirken hata:', error);
        res.status(500).send('Bir hata oluştu');
    }
});



// Quiz kaydetme işlemi
app.post('/api/quizzes', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Yetkisiz erişim' });
    }

    try {
        const { title, description, questions, categoryId } = req.body;

        // Verilerin varlığını kontrol et
        if (!title || !questions || !categoryId) {
            return res.status(400).json({ 
                success: false, 
                error: 'Lütfen tüm alanları doldurun' 
            });
        }

        // Yeni quiz oluştur
        const quiz = await db.Quiz.create({
            title,
            description: description || '',
            category_id: categoryId,
            user_id: req.session.user.id
        });

        // Soruları ekle
        for (const q of questions) {
            const question = await db.Question.create({
                question_text: q.text,
                quiz_id: quiz.id,
                category_id: categoryId,
                user_id: req.session.user.id
            });

            // Seçenekleri ekle
            for (const [index, option] of q.options.entries()) {
                await db.Option.create({
                    option_text: option.text,
                    is_correct: index === q.correctIndex,
                    question_id: question.id
                });
            }
        }

        res.json({ 
            success: true, 
            message: 'Quiz başarıyla oluşturuldu!',
            quizId: quiz.id
        });

    } catch (error) {
        console.error('Quiz kaydedilirken hata:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Quiz kaydedilirken bir hata oluştu: ' + error.message 
        });
    }
});




// Kullanılabilir quizleri listele
app.get('/quizler', isAuthenticated, async (req, res) => {
    try {
        const quizzes = await db.Quiz.findAll({
            include: [
                // { model: db.Category, as: 'category' },
                { model: db.Question, include: [db.Option] }
            ]
        });
        
        res.render('quizler', { 
            user: req.session.user,
            quizzes: quizzes,
            title: 'Quizleri Çöz'
        });
    } catch (error) {
        console.error('Quizler yüklenirken hata oluştu:', error);
        res.status(500).send('Bir hata oluştu');
    }
});

// Quiz çözme sayfası
app.get('/quiz/baslat/:id', isAuthenticated, async (req, res) => {
    try {
        const quiz = await Quiz.findByPk(req.params.id, {
            include: [
                { model: Category, as: 'category' },
                { 
                    model: Question, 
                    include: [Option],
                    order: [['createdAt', 'ASC']]
                }
            ]
        });

        if (!quiz) {
            return res.status(404).send('Quiz bulunamadı');
        }

        res.render('quiz-coz', { 
            user: req.session.user,
            quiz: quiz,
            title: quiz.title
        });
    } catch (error) {
        console.error('Quiz yüklenirken hata oluştu:', error);
        res.status(500).send('Bir hata oluştu');
    }
});

// Quiz sonuçlarını kaydet
app.post('/api/quizzes/submit', isAuthenticated, async (req, res) => {
    try {
        const { quizId, answers, timeSpent } = req.body;
        const userId = req.session.user.id;

        // Quiz'i al
        const quiz = await Quiz.findByPk(quizId, {
            include: [
                { model: Question, include: [Option] }
            ]
        });

        if (!quiz) {
            return res.status(404).json({ success: false, error: 'Quiz bulunamadı' });
        }

        // Quiz denemesini oluştur
        const attempt = await QuizAttempt.create({
            userId,
            quizId,
            score: 0,
            timeSpent,
            completedAt: new Date()
        });

        // Cevapları kaydet ve puanı hesapla
        let correctAnswers = 0;
        const questions = quiz.Questions;
        
        for (const answer of answers) {
            const question = questions.find(q => q.id === answer.questionId);
            if (!question) continue;

            const isCorrect = question.correctOptionIndex === answer.answerIndex;
            if (isCorrect) correctAnswers++;

            await UserAnswer.create({
                attemptId: attempt.id,
                questionId: question.id,
                answerIndex: answer.answerIndex,
                isCorrect,
                questionSnapshot: JSON.stringify({
                    text: question.text,
                    options: question.Options.map(o => o.text),
                    correctAnswer: question.correctOptionIndex
                })
            });
        }

        // Puanı güncelle
        const score = Math.round((correctAnswers / questions.length) * 100);
        await attempt.update({ score });

        res.json({ 
            success: true, 
            attemptId: attempt.id 
        });

    } catch (error) {
        console.error('Quiz kaydedilirken hata oluştu:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Quiz kaydedilirken bir hata oluştu' 
        });
    }
});

// Quiz sonuç sayfası
app.get('/quiz/sonuc/:attemptId', isAuthenticated, async (req, res) => {
    try {
        const attempt = await QuizAttempt.findByPk(req.params.attemptId, {
            include: [
                { model: Quiz, attributes: ['id', 'title'] },
                { 
                    model: UserAnswer,
                    order: [['createdAt', 'ASC']]
                }
            ]
        });

        if (!attempt) {
            return res.status(404).send('Sonuç bulunamadı');
        }

        // Eğer bu sonuç başka bir kullanıcıya aitse erişimi engelle
        if (attempt.userId !== req.session.user.id && !req.session.user.isAdmin) {
            return res.status(403).send('Bu sonuca erişim izniniz yok');
        }

        // Sonuç verilerini hazırla
        const userAnswers = attempt.UserAnswers;
        const totalQuestions = userAnswers.length;
        const correctAnswers = userAnswers.filter(a => a.isCorrect).length;
        const wrongAnswers = totalQuestions - correctAnswers;

        const result = {
            quizTitle: attempt.Quiz.title,
            totalQuestions,
            correctAnswers,
            wrongAnswers,
            timeSpent: attempt.timeSpent,
            score: attempt.score,
            completedAt: attempt.completedAt,
            questions: userAnswers.map(a => {
                const q = JSON.parse(a.questionSnapshot);
                return {
                    id: a.questionId,
                    text: q.text,
                    options: q.options,
                    correctAnswer: q.correctAnswer,
                    userAnswer: a.answerIndex,
                    isCorrect: a.isCorrect
                };
            })
        };

        res.render('quiz-sonuc', { 
            user: req.session.user,
            result,
            title: 'Quiz Sonucu - ' + attempt.Quiz.title
        });

    } catch (error) {
        console.error('Sonuçlar yüklenirken hata oluştu:', error);
        res.status(500).send('Bir hata oluştu');
    }
});

// Hata yönetimi middleware'i
// Bu middleware, hata oluştuğunda çalışır ve hata sayfasını gösterir
app.use((err, req, res, next) => {
    console.error('❌ Hata:', err.stack);
    res.status(500).render('hata', { 
        title: 'Bir Hata Oluştu',
        message: 'Üzgünüz, bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
    });
});

// 404 - Sayfa bulunamadı hatası
// Bu middleware, sayfa bulunamadığında çalışır ve 404 sayfasını gösterir
app.use((req, res) => {
    res.status(404).render('404', { 
        title: 'Sayfa Bulunamadı',
        message: 'Aradığınız sayfa mevcut değil veya taşınmış olabilir.'
    });
});

// Sunucuyu başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('====================================');
    console.log(`  Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    console.log(`  Veritabanı: ${process.env.DB_NAME || 'quiz_db'}`);
    console.log(`  Kullanıcı: ${process.env.DB_USER || 'root'}`);
    console.log('====================================');
    console.log('  Hata ayıklama modu:', process.env.NODE_ENV || 'development');
    console.log('====================================');
});